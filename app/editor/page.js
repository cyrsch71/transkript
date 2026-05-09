"use client";

import { useState, useRef, useEffect, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import WaveSurfer from "wavesurfer.js";
import SessionStats from "../components/SessionStats";

function formatTime(sec) {
    if (sec == null || isNaN(sec)) return "–";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function formatTimeBracket(sec) {
    return `[${formatTime(sec)}]`;
}

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

function EditorContent() {
    const searchParams = useSearchParams();
    const sessionParam = searchParams.get("session");
    const isNewMode = searchParams.get("new") === "1";

    // Determine mode: library (default), new (file upload), edit (existing session)
    const initialMode = sessionParam ? "edit" : isNewMode ? "new" : "library";
    const [mode, setMode] = useState(initialMode);

    /* ── State ── */
    const [audioFile, setAudioFile] = useState(null);
    const [audioUrl, setAudioUrl] = useState(null);
    const [audioFileName, setAudioFileName] = useState("");
    const [bgFile, setBgFile] = useState(null);
    const [bgFileName, setBgFileName] = useState("");
    const [rawLines, setRawLines] = useState([]);
    const [timestamps, setTimestamps] = useState([]); // null = pending, number = timestamp, "skip" = skipped
    const [currentLineIdx, setCurrentLineIdx] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [speed, setSpeed] = useState(1);
    const [editorReady, setEditorReady] = useState(false);
    const [history, setHistory] = useState([]); // for undo: [{index, prevValue}]
    const [isUploading, setIsUploading] = useState(false);
    const [uploadMessage, setUploadMessage] = useState("");
    const [showNameModal, setShowNameModal] = useState(false);
    const [sessionNameInput, setSessionNameInput] = useState("");
    const [editingLineIdx, setEditingLineIdx] = useState(null);
    const [editingText, setEditingText] = useState("");
    const [libSessions, setLibSessions] = useState([]);
    const [libLoading, setLibLoading] = useState(true);
    const [currentSessionId, setCurrentSessionId] = useState(sessionParam || "");
    const [currentDisplayName, setCurrentDisplayName] = useState("");
    const [sessionLoading, setSessionLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [toastMsg, setToastMsg] = useState("");
    const [lastAutoSaveCount, setLastAutoSaveCount] = useState(0);

    const [wsLoading, setWsLoading] = useState(true);

    const router = useRouter();

    useEffect(() => {
        if (sessionParam) {
            if (currentSessionId !== sessionParam) {
                setEditorReady(false); // Reset editor state for new session
            }
            setMode("edit");
            setCurrentSessionId(sessionParam);
        } else if (isNewMode) {
            setMode("new");
            setCurrentSessionId("");
            setEditorReady(false);
        } else {
            setMode("library");
            setCurrentSessionId("");
            setEditorReady(false);
        }
    }, [sessionParam, isNewMode, currentSessionId]);

    const audioRef = useRef(null);
    const lineListRef = useRef(null);
    const lineRefs = useRef([]);
    const waveformRef = useRef(null);
    const wsRef = useRef(null);

    /* ── File upload handlers ── */
    const handleAudioUpload = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setAudioFile(file);
        setAudioFileName(file.name);
        if (audioUrl) URL.revokeObjectURL(audioUrl);
        setAudioUrl(URL.createObjectURL(file));
    };

    const handleBgUpload = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setBgFile(file);
        setBgFileName(file.name);
    };

    const handleTextUpload = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            const text = ev.target.result;
            const lines = text.split("\n").filter((l) => l.trim().length > 0);
            setRawLines(lines);
            setTimestamps(new Array(lines.length).fill(null));
            setCurrentLineIdx(0);
            setHistory([]);
        };
        reader.readAsText(file);
    };

    const startEditor = () => {
        if (audioUrl && rawLines.length > 0) {
            setMode("edit");
            setEditorReady(true);
        }
    };

    /* ── Fetch library sessions ── */
    useEffect(() => {
        if (mode !== "library") return;
        const token = localStorage.getItem("gh_token");
        const user = localStorage.getItem("gh_user");
        const repo = localStorage.getItem("gh_repo");
        if (!token || !user || !repo) { setLibLoading(false); return; }

        fetch(`https://api.github.com/repos/${user}/${repo}/contents/public/transcripts`, {
            headers: { Authorization: `Bearer ${token}`, "If-None-Match": "" }, cache: 'no-store'
        })
        .then(r => r.ok ? r.json() : Promise.reject())
        .then(async data => {
            if (!Array.isArray(data)) return;
            const txtFiles = data.filter(f => f.name.endsWith(".txt") && f.name !== "sessions.json").map(f => f.name.replace(".txt", ""));
            const sessions = await Promise.all(txtFiles.map(async id => {
                try {
                    const res = await fetch(`https://api.github.com/repos/${user}/${repo}/contents/public/transcripts/${id}.txt`, {
                        headers: { Authorization: `Bearer ${token}`, "If-None-Match": "" }, cache: 'no-store'
                    });
                    if (!res.ok) return { id, displayName: id, done: 0, total: 0 };
                    const fileData = await res.json();
                    const text = base64ToUtf8(fileData.content.replace(/\n/g, ''));
                    const lines = text.split("\n").filter(l => l.trim());
                    let displayName = id;
                    const fl = lines[0]?.trim();
                    if (fl?.startsWith("# display_name:")) displayName = fl.replace("# display_name:", "").trim();
                    const contentLines = lines.filter(l => !l.startsWith("# display_name:"));
                    const done = contentLines.filter(l => /^\[\d{2}:\d{2}\]/.test(l)).length;
                    return { id, displayName, done, total: contentLines.length };
                } catch { return { id, displayName: id, done: 0, total: 0 }; }
            }));
            setLibSessions(sessions.reverse());
        })
        .catch(() => {})
        .finally(() => setLibLoading(false));
    }, [mode]);

    /* ── Load existing session from GitHub ── */
    useEffect(() => {
        if (mode !== "edit" || !sessionParam || editorReady) return;
        const token = localStorage.getItem("gh_token");
        const user = localStorage.getItem("gh_user");
        const repo = localStorage.getItem("gh_repo");
        if (!token || !user || !repo) return;

        setSessionLoading(true);
        const loadSession = async () => {
            // Fetch transcript
            const txtRes = await fetch(`https://api.github.com/repos/${user}/${repo}/contents/public/transcripts/${sessionParam}.txt`, {
                headers: { Authorization: `Bearer ${token}`, "If-None-Match": "" }, cache: 'no-store'
            });
            if (!txtRes.ok) throw new Error("Transkript bulunamadı");
            const fileData = await txtRes.json();
            const text = base64ToUtf8(fileData.content.replace(/\n/g, ''));
            const allLines = text.split("\n").filter(l => l.trim());
            
            let dName = sessionParam;
            const fl = allLines[0]?.trim();
            if (fl?.startsWith("# display_name:")) dName = fl.replace("# display_name:", "").trim();
            setCurrentDisplayName(dName);
            setSessionNameInput(dName);

            const contentLines = allLines.filter(l => !l.startsWith("# display_name:"));
            const parsedLines = [];
            const parsedTimestamps = [];
            let firstPending = -1;

            for (const line of contentLines) {
                const match = line.match(/^\[(\d{2}):(\d{2})\]\s*(.*)/);
                if (match) {
                    const sec = parseInt(match[1]) * 60 + parseInt(match[2]);
                    parsedLines.push(match[3]);
                    parsedTimestamps.push(sec);
                } else {
                    parsedLines.push(line);
                    parsedTimestamps.push(null);
                    if (firstPending === -1) firstPending = parsedLines.length - 1;
                }
            }

            setRawLines(parsedLines);
            setTimestamps(parsedTimestamps);
            setCurrentLineIdx(firstPending >= 0 ? firstPending : parsedLines.length);
            setLastAutoSaveCount(parsedTimestamps.filter(t => t !== null && t !== "skip").length);

            // Fetch audio
            const audioListRes = await fetch(`https://api.github.com/repos/${user}/${repo}/contents/public/audio`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (audioListRes.ok) {
                const files = await audioListRes.json();
                const match = Array.isArray(files) && files.find(f => f.name.startsWith(sessionParam + '.'));
                if (match) {
                    setAudioUrl(match.download_url);
                    setAudioFileName(match.name);
                } else {
                    throw new Error("Ses dosyası bulunamadı");
                }
            } else {
                throw new Error("Ses dosyalarına erişilemedi (Yetki hatası olabilir)");
            }

            setEditorReady(true);
            setSessionLoading(false);
        };
        loadSession().catch(e => { 
            console.error(e); 
            alert("Oturum yüklenirken hata oluştu:\n" + e.message);
            setSessionLoading(false); 
            setMode("library");
            router.push("/editor");
        });
    }, [mode, sessionParam, editorReady, router]);

    /* ── Build txt content ── */
    const buildTxtContent = useCallback(() => {
        let output = currentDisplayName ? `# display_name: ${currentDisplayName}\n` : "";
        for (let i = 0; i < rawLines.length; i++) {
            const ts = timestamps[i];
            if (ts === null || ts === "skip") {
                output += rawLines[i] + "\n";
            } else {
                output += `${formatTimeBracket(ts)} ${rawLines[i]}\n`;
            }
        }
        return output;
    }, [rawLines, timestamps, currentDisplayName]);

    /* ── Save progress to GitHub ── */
    const saveProgress = useCallback(async (silent = false) => {
        const token = localStorage.getItem("gh_token");
        const user = localStorage.getItem("gh_user");
        const repo = localStorage.getItem("gh_repo");
        if (!token || !user || !repo || !currentSessionId) return;

        if (!silent) setIsSaving(true);
        try {
            const content = buildTxtContent();
            const base64 = utf8ToBase64(content);
            await uploadToGitHub(`public/transcripts/${currentSessionId}.txt`, base64, `İlerleme kaydedildi: ${currentSessionId}`, token, user, repo);
            if (silent) {
                setToastMsg("Otomatik kaydedildi ✓");
                setTimeout(() => setToastMsg(""), 2500);
            }
        } catch(e) { console.error("Kaydetme hatası:", e); }
        finally { if (!silent) setIsSaving(false); }
    }, [currentSessionId, buildTxtContent]);

    /* ── Auto-save every 50 lines ── */
    useEffect(() => {
        if (!editorReady || !currentSessionId) return;
        const currentDone = timestamps.filter(t => t !== null && t !== "skip").length;
        if (currentDone > 0 && currentDone - lastAutoSaveCount >= 50) {
            setLastAutoSaveCount(currentDone);
            saveProgress(true);
        }
    }, [timestamps, editorReady, currentSessionId, lastAutoSaveCount, saveProgress]);

    /* ── Audio event handlers ── */
    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;

        const onTime = () => setCurrentTime(audio.currentTime);
        const onMeta = () => setDuration(audio.duration);
        const onPlay = () => setIsPlaying(true);
        const onPause = () => setIsPlaying(false);

        audio.addEventListener("timeupdate", onTime);
        audio.addEventListener("loadedmetadata", onMeta);
        audio.addEventListener("play", onPlay);
        audio.addEventListener("pause", onPause);

        return () => {
            audio.removeEventListener("timeupdate", onTime);
            audio.removeEventListener("loadedmetadata", onMeta);
            audio.removeEventListener("play", onPlay);
            audio.removeEventListener("pause", onPause);
        };
    }, [editorReady]);

    /* ── Find next un-timestamped line from a given index ── */
    const findNextPending = useCallback(
        (fromIdx) => {
            for (let i = fromIdx; i < timestamps.length; i++) {
                if (timestamps[i] === null) return i;
            }
            // All done from here – don't move
            return fromIdx;
        },
        [timestamps]
    );

    /* ── Assign timestamp ── */
    const assignTimestamp = useCallback(
        (index) => {
            if (!audioRef.current) return;
            const time = audioRef.current.currentTime;

            setTimestamps((prev) => {
                const next = [...prev];
                next[index] = time;
                return next;
            });

            setHistory((prev) => [
                ...prev,
                { index, prevValue: timestamps[index] },
            ]);

            // Advance to next pending line
            const nextIdx = findNextPending(index + 1);
            setCurrentLineIdx(nextIdx);

            // Resume playback if paused
            if (audioRef.current.paused) {
                audioRef.current.play().catch(() => {}); // catch silently to prevent overlay errors
            }
        },
        [timestamps, findNextPending, rawLines.length]
    );

    /* ── Controls ── */
    const undoLast = useCallback(() => {
        if (history.length === 0) return;
        const last = history[history.length - 1];
        setHistory((prev) => prev.slice(0, -1));
        setTimestamps((prev) => {
            const next = [...prev];
            next[last.index] = last.prevValue;
            return next;
        });
        setCurrentLineIdx(last.index);
    }, [history]);

    const skipCurrent = useCallback(() => {
        if (currentLineIdx >= rawLines.length) return;
        setTimestamps((prev) => {
            const next = [...prev];
            next[currentLineIdx] = "skip";
            return next;
        });
        setHistory((prev) => [
            ...prev,
            { index: currentLineIdx, prevValue: timestamps[currentLineIdx] },
        ]);
        const nextIdx = findNextPending(currentLineIdx + 1);
        setCurrentLineIdx(nextIdx);
    }, [currentLineIdx, rawLines.length, timestamps, findNextPending]);

    /* ── Keyboard handler: Space ── */
    useEffect(() => {
        if (!editorReady) return;

        const handleKey = (e) => {
            // Don't capture if typing in an input
            if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;

            if (e.code === "Space") {
                e.preventDefault();
                assignTimestamp(currentLineIdx);
            } else if (e.key.toLowerCase() === "s" || e.key === "Delete") {
                e.preventDefault();
                skipCurrent();
            } else if (e.code === "Backspace") {
                e.preventDefault();
                undoLast();
            } else if (e.key === "ArrowLeft") {
                e.preventDefault();
                if (audioRef.current) {
                    audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - 5);
                }
            } else if (e.key === "ArrowRight") {
                e.preventDefault();
                if (audioRef.current) {
                    audioRef.current.currentTime = Math.min(audioRef.current.duration || 0, audioRef.current.currentTime + 5);
                }
            } else if (e.key.toLowerCase() === "p") {
                e.preventDefault();
                if (audioRef.current) {
                    if (audioRef.current.paused) audioRef.current.play().catch(() => {});
                    else audioRef.current.pause();
                }
            }
        };

        window.addEventListener("keydown", handleKey);
        return () => window.removeEventListener("keydown", handleKey);
    }, [editorReady, currentLineIdx, assignTimestamp, skipCurrent, undoLast]);

    /* ── Auto-scroll current line into view ── */
    useEffect(() => {
        if (lineRefs.current[currentLineIdx]) {
            lineRefs.current[currentLineIdx].scrollIntoView({
                behavior: "smooth",
                block: "center",
            });
        }
    }, [currentLineIdx]);

    /* ── WaveSurfer Initialization ── */
    useEffect(() => {
        if (!editorReady || !audioUrl || !waveformRef.current || !audioRef.current) return;

        setWsLoading(true);
        const ws = WaveSurfer.create({
            container: waveformRef.current,
            media: audioRef.current,
            waveColor: '#4f46e5', // indigo-600 (muted)
            progressColor: '#818cf8', // indigo-400 (brighter)
            cursorColor: '#ffffff',
            barWidth: 2,
            barGap: 2,
            barRadius: 2,
            height: 48,
            normalize: true,
        });

        wsRef.current = ws;

        ws.on('ready', () => {
            setWsLoading(false);
        });

        return () => {
            ws.destroy();
            wsRef.current = null;
        };
    }, [editorReady, audioUrl]);

    const togglePlay = () => {
        if (!audioRef.current) return;
        if (isPlaying) audioRef.current.pause();
        else audioRef.current.play().catch(() => {});
    };

    const handleSeek = (e) => {
        if (audioRef.current) {
            audioRef.current.currentTime = parseFloat(e.target.value);
        }
    };

    const handleSpeedChange = (s) => {
        setSpeed(s);
        if (audioRef.current) audioRef.current.playbackRate = s;
    };

    /* ── GitHub Upload ── */
    const fileToBase64 = (file) => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => {
                const base64String = reader.result.split(",")[1];
                resolve(base64String);
            };
            reader.onerror = (error) => reject(error);
        });
    };

    function utf8ToBase64(str) {
        return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (match, p1) => {
            return String.fromCharCode('0x' + p1);
        }));
    }

    function base64ToUtf8(str) {
        return decodeURIComponent(Array.prototype.map.call(atob(str), (c) => {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));
    }

    const uploadToGitHub = async (path, contentBase64, message, token, user, repo) => {
        const url = `https://api.github.com/repos/${user}/${repo}/contents/${path}`;
        
        // Always fetch fresh SHA immediately before upload
        let sha = undefined;
        try {
            const getRes = await fetch(url, {
                headers: { 
                    Authorization: `Bearer ${token}`,
                    "If-None-Match": ""
                },
                cache: 'no-store'
            });
            if (getRes.ok) {
                const data = await getRes.json();
                sha = data.sha;
            }
            // 404 means file doesn't exist yet — that's fine, no sha needed
        } catch (e) {
            // Network error — proceed without sha
        }

        const body = {
            message,
            content: contentBase64,
            ...(sha && { sha })
        };

        const putRes = await fetch(url, {
            method: "PUT",
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(body)
        });

        if (!putRes.ok) {
            const err = await putRes.json();
            throw new Error(err.message || "Yükleme başarısız");
        }
        return await putRes.json();
    };

    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    const sanitizeName = (str) => {
        let s = str.replace(/Ğ/g, 'G').replace(/ğ/g, 'g')
                   .replace(/Ü/g, 'U').replace(/ü/g, 'u')
                   .replace(/Ş/g, 'S').replace(/ş/g, 's')
                   .replace(/İ/g, 'I').replace(/ı/g, 'i')
                   .replace(/Ö/g, 'O').replace(/ö/g, 'o')
                   .replace(/Ç/g, 'C').replace(/ç/g, 'c');
        return s.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-_]/g, '');
    };

    const handleUploadClick = () => {
        const gh_token = localStorage.getItem("gh_token");
        const gh_user = localStorage.getItem("gh_user");
        const gh_repo = localStorage.getItem("gh_repo");

        if (!gh_token || !gh_user || !gh_repo) {
            alert("Lütfen önce sağ üstteki ayarlar (⚙) ikonuna tıklayarak GitHub bilgilerinizi girin.");
            return;
        }

        if (audioFile && audioFile.size > 50 * 1024 * 1024) {
            alert("Ses dosyası 50MB'dan büyük olamaz (GitHub sınırı).");
            return;
        }

        // Default name without extension
        setSessionNameInput(audioFileName.replace(/\.[^/.]+$/, ""));
        setShowNameModal(true);
    };

    const executeUpload = async () => {
        if (!sessionNameInput.trim()) {
            alert("Lütfen bir oturum adı girin.");
            return;
        }

        setShowNameModal(false);
        setIsUploading(true);
        setUploadMessage("Transkript hazırlanıyor...");

        const gh_token = localStorage.getItem("gh_token");
        const gh_user = localStorage.getItem("gh_user");
        const gh_repo = localStorage.getItem("gh_repo");

        try {
            const displayName = sessionNameInput.trim();
            const baseName = sanitizeName(displayName);
            if (!baseName) {
                throw new Error("Geçerli bir oturum adı girmediniz.");
            }

            let output = `# display_name: ${displayName}\n`;
            for (let i = 0; i < rawLines.length; i++) {
                const ts = timestamps[i];
                if (ts === null || ts === "skip") {
                    output += rawLines[i] + "\n";
                } else {
                    output += `${formatTimeBracket(ts)} ${rawLines[i]}\n`;
                }
            }
            
            const textBase64 = utf8ToBase64(output);
            const ext = audioFileName.split('.').pop() || 'mp3';

            // Upload files sequentially to avoid GitHub SHA race conditions
            if (audioFile) {
                setUploadMessage("Ses dosyası yükleniyor...");
                const audioBase64 = await fileToBase64(audioFile);
                await uploadToGitHub(`public/audio/${baseName}.${ext}`, audioBase64, `Yeni oturum eklendi: ${baseName} (Ses)`, gh_token, gh_user, gh_repo);
                await delay(300);
            }
            
            await delay(300);
            
            setUploadMessage("Transkript metni yükleniyor...");
            await uploadToGitHub(`public/transcripts/${baseName}.txt`, textBase64, `Yeni oturum eklendi: ${baseName} (Metin)`, gh_token, gh_user, gh_repo);

            if (bgFile) {
                await delay(300);
                setUploadMessage("Arka plan fotoğrafı yükleniyor...");
                const bgBase64 = await fileToBase64(bgFile);
                await uploadToGitHub(`public/backgrounds/${baseName}.jpg`, bgBase64, `Arka plan eklendi: ${baseName}`, gh_token, gh_user, gh_repo);
            }

            await delay(300);

            setUploadMessage("Oturum listesi güncelleniyor...");
            const sessionsUrl = `https://api.github.com/repos/${gh_user}/${gh_repo}/contents/public/transcripts/sessions.json`;
            let sessionsSha = undefined;
            let sessionsList = [];
            
            try {
                const getRes = await fetch(sessionsUrl, { headers: { Authorization: `Bearer ${gh_token}` } });
                if (getRes.ok) {
                    const data = await getRes.json();
                    sessionsSha = data.sha;
                    const content = base64ToUtf8(data.content.replace(/\n/g, ''));
                    sessionsList = JSON.parse(content);
                }
            } catch (e) {
                console.warn("sessions.json alınamadı", e);
            }

            if (!sessionsList.includes(baseName)) {
                sessionsList.unshift(baseName);
                const newSessionsBase64 = utf8ToBase64(JSON.stringify(sessionsList, null, 2));
                await fetch(sessionsUrl, {
                    method: "PUT",
                    headers: {
                        Authorization: `Bearer ${gh_token}`,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        message: `Oturum listesi güncellendi: ${baseName}`,
                        content: newSessionsBase64,
                        ...(sessionsSha && { sha: sessionsSha })
                    })
                });
            }

            setUploadMessage("Başarıyla yüklendi! Site güncelleniyor...");
            setTimeout(() => {
                router.push("/");
            }, 2000);

        } catch (error) {
            console.error(error);
            alert("Yükleme sırasında hata oluştu:\n" + error.message);
            setIsUploading(false);
            setUploadMessage("");
        }
    };

    /* ── Stats ── */
    const doneCount = timestamps.filter(
        (t) => t !== null && t !== "skip"
    ).length;
    const totalCount = rawLines.length;

    /* ────────────────── RENDER ────────────────── */

    // Session loading screen
    if (sessionLoading) {
        return (
            <div className="flex-1 flex items-center justify-center">
                <div className="flex flex-col items-center gap-4 text-gray-400">
                    <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                    <p>Oturum yükleniyor...</p>
                </div>
            </div>
        );
    }

    // Library mode
    if (mode === "library") {
        return (
            <div className="flex-1 overflow-y-auto p-6 md:p-10 bg-[#1a1a1a]">
                <div className="max-w-7xl mx-auto space-y-8">
                    <div className="flex items-center justify-between">
                        <h1 className="text-3xl font-bold text-white">Editör</h1>
                        <button onClick={() => setMode("new")} className="px-5 py-2.5 rounded-xl font-semibold text-white bg-indigo-600 hover:bg-indigo-500 transition-colors">
                            + Yeni Oturum
                        </button>
                    </div>
                    {libLoading ? (
                        <div className="flex flex-col items-center py-20 text-gray-400 gap-4">
                            <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                            <p>Oturumlar yükleniyor...</p>
                        </div>
                    ) : libSessions.length === 0 ? (
                        <div className="text-center py-20 text-gray-500 bg-[#222] rounded-2xl border border-white/5">
                            <span className="text-4xl block mb-4">📭</span>
                            Kayıtlı oturum bulunamadı.
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                            {libSessions.map(s => {
                                const pct = s.total > 0 ? Math.round((s.done / s.total) * 100) : 0;
                                const user = localStorage.getItem("gh_user");
                                const repo = localStorage.getItem("gh_repo");
                                return (
                                    <Link href={`/editor?session=${encodeURIComponent(s.id)}`} key={s.id} className="group block outline-none">
                                        <div className="relative aspect-video rounded-2xl overflow-hidden bg-[#222] border border-white/5 shadow-lg group-hover:shadow-indigo-500/20 transition-all duration-300">
                                            {user && repo && (
                                                <img src={`https://raw.githubusercontent.com/${user}/${repo}/main/public/backgrounds/${s.id}.jpg`} alt="" className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" onError={e => e.target.style.display='none'} />
                                            )}
                                            <div className="absolute inset-x-0 bottom-0 pt-16 pb-3 px-4 bg-gradient-to-t from-black/90 via-black/50 to-transparent">
                                                <h3 className="text-white font-bold text-base truncate group-hover:text-indigo-300 transition-colors">{s.displayName}</h3>
                                                <div className="mt-1.5 flex items-center gap-2">
                                                    <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                                                        <div className="h-full rounded-full transition-all" style={{width:`${pct}%`, background: pct === 100 ? '#10b981' : '#6366f1'}}></div>
                                                    </div>
                                                    <span className="text-xs text-gray-400 font-mono shrink-0">{s.done}/{s.total}</span>
                                                </div>
                                                <SessionStats session={s} ghConfig={{ user, repo, token: localStorage.getItem("gh_token") }} />
                                            </div>
                                        </div>
                                    </Link>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // New session (file upload) screen
    if (mode === "new" && !editorReady) {
        return (
            <div className="flex-1 flex items-center justify-center p-6">
                <div className="w-full max-w-lg bg-[#222] rounded-2xl border border-white/10 p-8 space-y-6">
                    <div className="flex items-center justify-between">
                        <h1 className="text-2xl font-bold text-gray-100">Yeni Oturum</h1>
                        <button onClick={() => setMode("library")} className="text-sm text-gray-400 hover:text-white transition-colors">← Geri</button>
                    </div>

                    {/* Audio upload */}
                    <div className="space-y-2">
                        <label className="block text-sm font-medium text-gray-300">
                            🎵 Ses dosyası yükle (.mp3 / .wav)
                        </label>
                        <input
                            type="file"
                            accept=".mp3,.wav,.m4a,audio/*"
                            onChange={handleAudioUpload}
                            className="block w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-indigo-600 file:text-white hover:file:bg-indigo-500 file:cursor-pointer cursor-pointer"
                        />
                        {audioFileName && (
                            <p className="text-xs text-indigo-400">✓ {audioFileName}</p>
                        )}
                    </div>

                    {/* Text upload */}
                    <div className="space-y-2">
                        <label className="block text-sm font-medium text-gray-300">
                            📄 Metin dosyası yükle (.txt)
                        </label>
                        <input
                            type="file"
                            accept=".txt,text/plain"
                            onChange={handleTextUpload}
                            className="block w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-indigo-600 file:text-white hover:file:bg-indigo-500 file:cursor-pointer cursor-pointer"
                        />
                        {rawLines.length > 0 && (
                            <p className="text-xs text-indigo-400">
                                ✓ {rawLines.length} satır yüklendi
                            </p>
                        )}
                    </div>

                    {/* Background upload */}
                    <div className="space-y-2">
                        <label className="block text-sm font-medium text-gray-300">
                            🖼 Arka Plan Fotoğrafı Seç (İsteğe bağlı)
                        </label>
                        <input
                            type="file"
                            accept=".jpg,.jpeg,.png,.webp,image/*"
                            onChange={handleBgUpload}
                            className="block w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-indigo-600 file:text-white hover:file:bg-indigo-500 file:cursor-pointer cursor-pointer"
                        />
                        {bgFileName && (
                            <p className="text-xs text-indigo-400">✓ {bgFileName}</p>
                        )}
                    </div>

                    {/* Start button */}
                    <button
                        onClick={startEditor}
                        disabled={!audioUrl || rawLines.length === 0}
                        className="w-full py-3 rounded-xl font-semibold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                        Editörü Başlat
                    </button>
                </div>
            </div>
        );
    }

    // Editor interface
    return (
        <div className="flex-1 flex flex-col overflow-hidden">
            <audio ref={audioRef} src={audioUrl} preload="metadata" />

            {/* ── Top bar ── */}
            <div className="shrink-0 bg-[#111] border-b border-white/10 px-4 py-3 space-y-3">
                {/* Controls row */}
                <div className="flex items-center gap-3 flex-wrap">
                    {/* Play/Pause */}
                    <button
                        onClick={togglePlay}
                        className="w-10 h-10 flex items-center justify-center rounded-full bg-indigo-600 hover:bg-indigo-500 transition-colors text-white text-lg shrink-0"
                        title={isPlaying ? "Durdur" : "Oynat"}
                    >
                        {isPlaying ? "⏸" : "▶"}
                    </button>

                    {/* Time + seeker */}
                    <span className="text-xs text-gray-400 font-mono w-12 text-right shrink-0">
                        {formatTime(currentTime)}
                    </span>
                    <div className="flex-1 relative min-w-[200px] h-12 bg-[#1a1a1a] rounded-lg overflow-hidden border border-white/5">
                        {wsLoading && (
                            <div className="absolute inset-0 flex items-center justify-center text-xs text-indigo-400 bg-[#1a1a1a] z-10">
                                Ses dalgası yükleniyor...
                            </div>
                        )}
                        <div ref={waveformRef} className="w-full h-full" />
                    </div>
                    <span className="text-xs text-gray-400 font-mono w-12 shrink-0">
                        {formatTime(duration)}
                    </span>

                    {/* Speed */}
                    <div className="flex items-center gap-1">
                        <span className="text-xs text-gray-400">Hız</span>
                        <div className="flex gap-0.5">
                            {SPEEDS.map((s) => (
                                <button
                                    key={s}
                                    onClick={() => handleSpeedChange(s)}
                                    className={`px-1.5 py-0.5 text-xs rounded transition-all ${speed === s
                                            ? "bg-indigo-600 text-white"
                                            : "bg-[#333] text-gray-400 hover:bg-[#444]"
                                        }`}
                                >
                                    {s}x
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Undo + Skip */}
                    <button
                        onClick={undoLast}
                        disabled={history.length === 0}
                        className="px-3 py-1.5 text-xs rounded-lg bg-[#333] text-gray-300 hover:bg-[#444] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                        ↩ Geri Al
                    </button>
                    <button
                        onClick={skipCurrent}
                        className="px-3 py-1.5 text-xs rounded-lg bg-[#333] text-gray-300 hover:bg-[#444] transition-colors"
                    >
                        ⏭ Atla
                    </button>

                    <div className="ml-auto flex items-center gap-2">
                        {/* Save */}
                        {currentSessionId && (
                            <button
                                onClick={() => saveProgress(false)}
                                disabled={isSaving}
                                className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-[#333] text-gray-200 hover:bg-[#444] transition-colors disabled:opacity-50"
                            >
                                {isSaving ? "Kaydediliyor..." : "💾 Kaydet"}
                            </button>
                        )}
                        {/* Upload */}
                        <button
                            onClick={handleUploadClick}
                            disabled={isUploading}
                            className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-teal-700 text-white hover:bg-teal-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isUploading ? "Yükleniyor..." : "Bitir"}
                        </button>
                        {/* Progress */}
                        <span className="text-xs text-gray-400 font-mono">
                            {doneCount} / {totalCount}
                        </span>
                    </div>
                </div>
            </div>

            {/* ── Main editor area ── */}
            <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
                {/* Left panel: Current segment */}
                <div className="md:w-2/5 shrink-0 flex flex-col items-center justify-center p-6 md:p-10 bg-[#1f1a0e] border-b md:border-b-0 md:border-r border-amber-900/40">
                    <p className="text-xs text-amber-500/70 uppercase tracking-widest mb-4 font-medium">
                        İşaretlenecek Segment
                    </p>
                    <div className="bg-amber-950/50 rounded-2xl px-8 py-6 border border-amber-800/30 w-full max-w-md flex flex-col items-center text-center">
                        <p className="text-xs text-amber-600 mb-2 font-mono">
                            Satır {currentLineIdx + 1}
                        </p>
                        <p className="text-xl md:text-2xl text-amber-100 leading-relaxed font-medium">
                            {rawLines[currentLineIdx] || "Tüm satırlar işaretlendi!"}
                        </p>
                    </div>
                    
                    <div className="flex gap-3 mt-8 w-full max-w-md justify-center flex-wrap">
                        <button
                            onClick={() => assignTimestamp(currentLineIdx)}
                            disabled={currentLineIdx >= rawLines.length}
                            className="px-5 py-3 rounded-xl font-semibold text-amber-950 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                            Zaman Ata (Space)
                        </button>
                        <button
                            onClick={skipCurrent}
                            disabled={currentLineIdx >= rawLines.length}
                            className="px-5 py-3 rounded-xl font-semibold text-gray-200 bg-[#333] hover:bg-[#444] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                            Atla / Sil (S)
                        </button>
                    </div>
                    <div className="mt-4">
                        <button
                            onClick={undoLast}
                            disabled={history.length === 0}
                            className="px-5 py-2.5 rounded-xl text-sm font-semibold text-gray-300 bg-transparent border border-gray-600 hover:bg-gray-800 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                            Geri Al (Backspace)
                        </button>
                    </div>
                </div>

                {/* Right panel: Line list */}
                <div
                    ref={lineListRef}
                    className="flex-1 overflow-y-auto p-4"
                >
                    <div className="space-y-0.5">
                        {rawLines.map((line, i) => {
                            const ts = timestamps[i];
                            const isCurrent = i === currentLineIdx;
                            const isDone = ts !== null && ts !== "skip";
                            const isSkipped = ts === "skip";
                            const isEditing = editingLineIdx === i;

                            return (
                                <div
                                    key={i}
                                    ref={(el) => (lineRefs.current[i] = el)}
                                    className={`
                    flex items-start gap-3 px-3 py-2 rounded-lg transition-all text-sm
                    ${isCurrent
                                            ? "bg-indigo-950/60 border-l-4 border-indigo-500"
                                            : isDone
                                                ? "opacity-40 border-l-4 border-transparent hover:opacity-60"
                                                : isSkipped
                                                    ? "opacity-30 border-l-4 border-transparent"
                                                    : "border-l-4 border-transparent hover:bg-white/5"
                                        }
                  `}
                                >
                                    {/* Row number */}
                                    <span className="text-xs text-gray-600 font-mono w-6 text-right shrink-0 mt-0.5">
                                        {i + 1}
                                    </span>

                                    {/* Timestamp */}
                                    <span
                                        className={`text-xs font-mono w-14 shrink-0 mt-0.5 ${isDone
                                                ? "text-teal-500"
                                                : isSkipped
                                                    ? "text-gray-600"
                                                    : "text-gray-600"
                                            }`}
                                    >
                                        {isDone ? formatTimeBracket(ts) : "–"}
                                    </span>

                                    {/* Text - editable on click */}
                                    {isEditing ? (
                                        <input
                                            type="text"
                                            value={editingText}
                                            onChange={(e) => setEditingText(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === "Enter") {
                                                    e.preventDefault();
                                                    setRawLines(prev => {
                                                        const next = [...prev];
                                                        next[i] = editingText;
                                                        return next;
                                                    });
                                                    setEditingLineIdx(null);
                                                }
                                                if (e.key === "Escape") {
                                                    setEditingLineIdx(null);
                                                }
                                            }}
                                            onBlur={() => {
                                                setRawLines(prev => {
                                                    const next = [...prev];
                                                    next[i] = editingText;
                                                    return next;
                                                });
                                                setEditingLineIdx(null);
                                            }}
                                            autoFocus
                                            className="flex-1 bg-[#111] border border-indigo-500 rounded px-2 py-0.5 text-white text-sm focus:outline-none"
                                        />
                                    ) : (
                                        <span
                                            onClick={() => {
                                                if (isDone) {
                                                    // Kullanıcının yeni isteği: tek tıklama ile o saniyeye git (seek)
                                                    if (audioRef.current && typeof ts === "number") {
                                                        audioRef.current.currentTime = ts;
                                                    }
                                                } else {
                                                    setEditingLineIdx(i);
                                                    setEditingText(line);
                                                }
                                            }}
                                            onDoubleClick={() => {
                                                if (isDone) {
                                                    // Çift tıklama ile metni düzenleme
                                                    setEditingLineIdx(i);
                                                    setEditingText(line);
                                                }
                                            }}
                                            className={`cursor-pointer hover:underline hover:decoration-dotted ${isCurrent ? "text-white" : "text-gray-400"}`}
                                        >
                                            {line}
                                        </span>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* Upload Overlay */}
            {isUploading && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
                    <div className="bg-[#222] border border-white/10 rounded-2xl p-8 flex flex-col items-center max-w-sm w-full shadow-2xl text-center">
                        <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mb-4"></div>
                        <h3 className="text-lg font-bold text-white mb-2">İşlem Yapılıyor</h3>
                        <p className="text-sm text-gray-400">{uploadMessage}</p>
                    </div>
                </div>
            )}

            {/* Name Modal */}
            {showNameModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
                    <div className="bg-[#1a1a1a] border border-white/10 rounded-2xl p-6 max-w-md w-full shadow-2xl">
                        <h3 className="text-xl font-bold text-white mb-4">Oturumu Kaydet</h3>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-400 mb-1">
                                    Oturum adı
                                </label>
                                <input
                                    type="text"
                                    value={sessionNameInput}
                                    onChange={(e) => setSessionNameInput(e.target.value)}
                                    placeholder="örn: Ahmet ile röportaj"
                                    className="w-full bg-[#262626] border border-white/10 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
                                />
                            </div>
                            <div className="flex justify-end gap-3 pt-2">
                                <button
                                    onClick={() => setShowNameModal(false)}
                                    className="px-4 py-2 rounded-lg font-medium text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
                                >
                                    İptal
                                </button>
                                <button
                                    onClick={executeUpload}
                                    className="px-4 py-2 rounded-lg font-medium text-white bg-indigo-600 hover:bg-indigo-500 transition-colors"
                                >
                                    Kaydet ve Yükle
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Toast Notification */}
            {toastMsg && (
                <div className="fixed bottom-6 right-6 z-50 bg-teal-600 text-white px-4 py-2 rounded-lg shadow-lg font-medium animate-bounce">
                    {toastMsg}
                </div>
            )}
        </div>
    );
}

export default function EditorPage() {
    return (
        <Suspense fallback={
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-gray-400">
                <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mb-4"></div>
                Yükleniyor...
            </div>
        }>
            <EditorContent />
        </Suspense>
    );
}
