"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

export default function SessionDetailPage() {
    const params = useParams();
    const router = useRouter();
    const sessionId = params.sessionname ? decodeURIComponent(params.sessionname) : "";

    const [loading, setLoading] = useState(true);
    const [bgError, setBgError] = useState(false);
    const [ghConfig, setGhConfig] = useState(null);

    // Metadata
    const [displayName, setDisplayName] = useState("");
    const [voiceActor, setVoiceActor] = useState("");
    const [category, setCategory] = useState("");
    const [description, setDescription] = useState("");
    const [tags, setTags] = useState([]);
    const [originalLink, setOriginalLink] = useState("");
    const [durationStr, setDurationStr] = useState("–");

    useEffect(() => {
        const token = localStorage.getItem("gh_token");
        const user = localStorage.getItem("gh_user");
        const repo = localStorage.getItem("gh_repo");
        if (token && user && repo) {
            setGhConfig({ token, user, repo });
        } else {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!sessionId || !ghConfig) return;
        setLoading(true);

        const { user, repo, token } = ghConfig;
        const apiUrl = `https://api.github.com/repos/${user}/${repo}/contents/public/transcripts/${sessionId}.txt`;

        fetch(apiUrl, {
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/vnd.github.v3.raw"
            },
            cache: "no-store"
        })
            .then(r => r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`)))
            .then(text => {
                const lines = text.split("\n");
                let dName = sessionId;
                let vActor = "";
                let cat = "";
                let desc = "";
                let tgs = [];
                let origLink = "";
                let exactDuration = null;
                let total = 0;
                let lastTimestamp = 0;

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed) continue;

                    if (trimmed.startsWith("# display_name:")) {
                        dName = trimmed.replace("# display_name:", "").trim();
                    } else if (trimmed.startsWith("# voice_actor:")) {
                        vActor = trimmed.replace("# voice_actor:", "").trim();
                    } else if (trimmed.startsWith("# category:")) {
                        cat = trimmed.replace("# category:", "").trim();
                    } else if (trimmed.startsWith("# description:")) {
                        desc = trimmed.replace("# description:", "").trim();
                    } else if (trimmed.startsWith("# tags:")) {
                        const tagsStr = trimmed.replace("# tags:", "").trim();
                        tgs = tagsStr ? tagsStr.split(",").map(t => t.trim()).filter(Boolean) : [];
                    } else if (trimmed.startsWith("# original_link:")) {
                        origLink = trimmed.replace("# original_link:", "").trim();
                    } else if (trimmed.startsWith("# audio_duration:")) {
                        exactDuration = trimmed.replace("# audio_duration:", "").trim();
                    } else if (!trimmed.startsWith("#")) {
                        total++;
                        const match = trimmed.match(/^\[(?:(\d{1,2}):)?(\d{2}):(\d{2})\]/);
                        if (match) {
                            let h = match[1] ? parseInt(match[1]) : 0;
                            let m = parseInt(match[2]);
                            let s = parseInt(match[3]);
                            lastTimestamp = h * 3600 + m * 60 + s;
                        }
                    }
                }

                let durStr = exactDuration || "–";
                if (!exactDuration && lastTimestamp > 0) {
                    let m = Math.floor(lastTimestamp / 60);
                    let s = lastTimestamp % 60;
                    durStr = `${m}:${s.toString().padStart(2, "0")}`;
                }

                setDisplayName(dName);
                setVoiceActor(vActor);
                setCategory(cat);
                setDescription(desc);
                setTags(tgs);
                setOriginalLink(origLink);
                setDurationStr(durStr);
            })
            .catch(e => {
                console.error("Session detail load error:", e);
                setDisplayName(sessionId);
            })
            .finally(() => setLoading(false));
    }, [sessionId, ghConfig]);

    useEffect(() => {
        if (displayName) {
            document.title = `${displayName} - Transkript`;
        }
    }, [displayName]);

    const handleFilterNavigate = useCallback((type, value) => {
        const params = new URLSearchParams();
        params.set(type, value);
        router.push(`/?${params.toString()}`);
    }, [router]);

    if (loading) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center bg-black text-gray-500 gap-4 min-h-screen">
                <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                <p className="text-lg">Oturum yükleniyor...</p>
            </div>
        );
    }

    const bgUrl = ghConfig
        ? `https://raw.githubusercontent.com/${ghConfig.user}/${ghConfig.repo}/main/public/backgrounds/${sessionId}.jpg`
        : null;

    return (
        <div className="flex-1 flex flex-col min-h-screen relative overflow-hidden bg-black">
            {/* ── Full-screen background image ── */}
            {!bgError && bgUrl && (
                <img
                    src={bgUrl}
                    alt=""
                    className="fixed inset-0 w-full h-full object-cover z-0"
                    onError={() => setBgError(true)}
                />
            )}

            {/* ── Gradient overlays ── */}
            {/* Horizontal: left visible → right dark */}
            <div
                className="fixed inset-0 z-[1] pointer-events-none"
                style={{
                    background: "linear-gradient(to right, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0.5) 50%, rgba(0,0,0,0.85) 100%)"
                }}
            />
            {/* Bottom fade */}
            <div
                className="fixed inset-0 z-[2] pointer-events-none"
                style={{
                    background: "linear-gradient(to top, rgba(0,0,0,0.95) 0%, transparent 40%)"
                }}
            />

            {/* ── Content layer ── */}
            <div className="relative z-10 flex-1 flex flex-col min-h-screen">

                {/* ── Top bar ── */}
                <div className="flex items-start justify-between p-6 md:p-8 shrink-0">
                    {/* Back button */}
                    <Link
                        href="/"
                        className="flex items-center gap-2 text-white/60 text-sm font-semibold hover:text-white transition-all bg-white/5 hover:bg-white/10 px-4 py-2 rounded-full backdrop-blur-md border border-white/10"
                    >
                        <span>←</span> Kütüphane
                    </Link>

                    {/* Tags (top right) */}
                    {tags.length > 0 && (
                        <div className="flex flex-wrap gap-2 justify-end">
                            {tags.map((tag, i) => (
                                <span
                                    key={i}
                                    className="px-3.5 py-1.5 text-[11px] font-bold rounded-full bg-white/15 text-white/90 backdrop-blur-md border border-white/10 uppercase tracking-wider"
                                >
                                    {tag}
                                </span>
                            ))}
                        </div>
                    )}
                </div>

                {/* ── Spacer ── */}
                <div className="flex-1 min-h-[80px]" />

                {/* ── Right-side content ── */}
                <div className="flex flex-col items-end px-6 md:px-12 lg:px-16 xl:px-20 pb-6 gap-5 max-w-screen-2xl ml-auto w-full">

                    {/* Session Name */}
                    <style dangerouslySetInnerHTML={{ __html: `@import url('https://fonts.googleapis.com/css2?family=Oswald:wght@600;700&display=swap');` }} />
                    <h1
                        className="text-right leading-none"
                        style={{
                            fontFamily: "'Oswald', sans-serif",
                            fontSize: "clamp(2.5rem, 6vw, 4.5rem)",
                            fontWeight: 700,
                            color: "white",
                            letterSpacing: "0.02em",
                            textShadow: "0 4px 40px rgba(0,0,0,0.7)",
                        }}
                    >
                        {(displayName || sessionId).toUpperCase()}
                    </h1>

                    {/* Description */}
                    {description && (
                        <p
                            className="text-right leading-relaxed"
                            style={{
                                maxWidth: "480px",
                                color: "rgba(255,255,255,0.8)",
                                fontSize: "0.95rem",
                                lineHeight: 1.6,
                                textShadow: "0 2px 12px rgba(0,0,0,0.5)",
                            }}
                        >
                            {description}
                        </p>
                    )}

                    {/* ── Action Area (Boxes + Original Audio) ── */}
                    <div className="flex flex-col gap-3 w-full items-end" style={{ maxWidth: "680px" }}>
                        
                        {/* Top Row: Info Grid + Action Buttons (Equal Height) */}
                        <div className="flex flex-col md:flex-row gap-4 w-full items-stretch justify-end">
                            {/* ── Info Grid Box (Left) ── */}
                            <div
                                className="rounded-xl overflow-hidden flex-1 min-w-0"
                                style={{
                                    background: "rgba(45,42,38,0.75)",
                                    backdropFilter: "blur(12px)",
                                    WebkitBackdropFilter: "blur(12px)",
                                    border: "1px solid rgba(255,255,255,0.08)",
                                }}
                            >
                                <div className="grid grid-cols-2 h-full">
                                    {/* Cell 1 — Voice Actor */}
                                    <div
                                        className={`px-5 py-4 ${voiceActor ? "cursor-pointer group" : ""}`}
                                        style={{ borderRight: "1px solid rgba(255,255,255,0.06)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}
                                        onClick={() => voiceActor && handleFilterNavigate("voice_actor", voiceActor)}
                                    >
                                        <p className="text-[10px] font-bold text-white/40 uppercase tracking-[0.15em] mb-1.5">Seslendiren</p>
                                        <p className={`text-sm font-semibold text-white/90 truncate ${voiceActor ? "group-hover:text-indigo-400 transition-colors" : ""}`}>
                                            {voiceActor || "–"}
                                        </p>
                                    </div>

                                    {/* Cell 2 — Category */}
                                    <div
                                        className={`px-5 py-4 ${category ? "cursor-pointer group" : ""}`}
                                        style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
                                        onClick={() => category && handleFilterNavigate("category", category)}
                                    >
                                        <p className="text-[10px] font-bold text-white/40 uppercase tracking-[0.15em] mb-1.5">Kategori</p>
                                        <p className={`text-sm font-semibold text-white/90 truncate ${category ? "group-hover:text-indigo-400 transition-colors" : ""}`}>
                                            {category || "–"}
                                        </p>
                                    </div>

                                    {/* Cell 3 — Duration */}
                                    <div className="px-5 py-4" style={{ borderRight: "1px solid rgba(255,255,255,0.06)" }}>
                                        <p className="text-[10px] font-bold text-white/40 uppercase tracking-[0.15em] mb-1.5">Süre</p>
                                        <p className="text-sm font-semibold text-white/90">{durationStr}</p>
                                    </div>

                                    {/* Cell 4 — Tags (Etiketler) */}
                                    <div className="px-5 py-4">
                                        <p className="text-[10px] font-bold text-white/40 uppercase tracking-[0.15em] mb-1.5">Etiketler</p>
                                        {tags.length > 0 ? (
                                            <div className="flex flex-wrap gap-1">
                                                {tags.map((tag, i) => (
                                                    <span key={i} className="text-xs font-medium text-white/80 bg-white/10 px-1.5 py-0.5 rounded">
                                                        {tag}
                                                    </span>
                                                ))}
                                            </div>
                                        ) : (
                                            <p className="text-sm font-semibold text-white/90">–</p>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* ── Action Buttons Box (Right) ── */}
                            <div
                                className="rounded-xl overflow-hidden flex-shrink-0 flex flex-col justify-center"
                                style={{
                                    width: "220px",
                                    background: "rgba(45,42,38,0.75)",
                                    backdropFilter: "blur(12px)",
                                    WebkitBackdropFilter: "blur(12px)",
                                    border: "1px solid rgba(255,255,255,0.08)",
                                }}
                            >
                                <div className="p-4 space-y-3">
                                    {/* Play */}
                                    <Link
                                        href={`/player?session=${encodeURIComponent(sessionId)}`}
                                        className="flex items-center justify-center gap-2.5 w-full py-3.5 rounded-lg font-bold text-white text-sm tracking-wide transition-all hover:brightness-110 active:scale-[0.98]"
                                        style={{
                                            background: "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)",
                                            boxShadow: "0 4px 20px rgba(99,102,241,0.3)",
                                        }}
                                    >
                                        <span className="text-base">▶</span> Oynat
                                    </Link>

                                    {/* Edit */}
                                    <Link
                                        href={`/editor?session=${encodeURIComponent(sessionId)}`}
                                        className="flex items-center justify-center gap-2.5 w-full py-3 rounded-lg font-bold text-white/80 hover:text-white text-sm tracking-wide border border-white/15 hover:border-white/30 hover:bg-white/5 transition-all active:scale-[0.98]"
                                    >
                                        <span>✏</span> Düzenle
                                    </Link>
                                </div>
                            </div>
                        </div>

                        {/* ── Original Audio Button (Bottom Right) ── */}
                        {originalLink && (
                            <a
                                href={originalLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center justify-center gap-2.5 py-3 rounded-full text-sm font-semibold text-white/70 hover:text-white transition-all hover:bg-white/10 active:scale-[0.97]"
                                style={{
                                    width: "220px",
                                    background: "rgba(0,0,0,0.5)",
                                    backdropFilter: "blur(10px)",
                                    border: "1px solid rgba(255,255,255,0.1)",
                                }}
                            >
                                <span className="text-base">▶</span> Orijinal Ses
                            </a>
                        )}

                    </div>
                </div>

                {/* Bottom padding */}
                <div className="h-6" />
            </div>
        </div>
    );
}
