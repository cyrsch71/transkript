"use client";

import { useState, useRef, useEffect, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

/* ───── Transcript parser ───── */
function parseTranscript(text) {
  const lines = text.split("\n").filter((l) => l.trim());
  const result = [];

  for (const line of lines) {
    // Match [MM:SS] or [HH:MM:SS]
    const match = line.match(/^\[(\d{1,2}:)?(\d{2}):(\d{2})\]\s*(.*)/);
    if (!match) continue;

    const hours = match[1] ? parseInt(match[1]) : 0;
    const minutes = parseInt(match[2]);
    const seconds = parseInt(match[3]);
    const totalSeconds = hours * 3600 + minutes * 60 + seconds;
    const rawText = match[4];

    // Strip all (...) and [...] segments from visible text
    const visibleText = rawText
      .replace(/\[.*?\]/g, "")
      .replace(/\(.*?\)/g, "")
      .trim();

    // Only include lines with real spoken dialogue
    if (visibleText.length === 0) continue;

    result.push({
      time: totalSeconds,
      text: visibleText,
      raw: rawText,
    });
  }
  return result;
}

function formatTime(sec) {
  if (!sec || isNaN(sec)) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

function PlayerContent() {
  const searchParams = useSearchParams();
  const currentSession = searchParams.get("session") || "";

  const [lines, setLines] = useState([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [loading, setLoading] = useState(true);
  const [bgError, setBgError] = useState(false);
  const [ghConfig, setGhConfig] = useState(null);
  const [displayName, setDisplayName] = useState("");
  const [audioUrl, setAudioUrl] = useState(null);

  // Search states
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [selectedResultIndex, setSelectedResultIndex] = useState(-1);

  const audioRef = useRef(null);
  const transcriptRef = useRef(null);
  const lineRefs = useRef([]);

  // Initial token load
  useEffect(() => {
    const token = localStorage.getItem("gh_token");
    const user = localStorage.getItem("gh_user");
    const repo = localStorage.getItem("gh_repo");
    if (token && user && repo) {
      setGhConfig({ token, user, repo });
    } else {
      setLoading(false);
      // Wait a bit before alerting to not interrupt initial render badly, but simple is fine
      console.warn("GitHub ayarları eksik.");
    }
  }, []);

  const base64ToUtf8 = (str) => {
      try {
          return decodeURIComponent(escape(atob(str)));
      } catch {
          return atob(str);
      }
  };

  // Load transcript when session changes
  useEffect(() => {
    if (!currentSession || !ghConfig) return;
    setLoading(true);
    setBgError(false);

    const { user, repo, token } = ghConfig;

    fetch(`https://api.github.com/repos/${user}/${repo}/contents/public/transcripts/${currentSession}.txt`, {
      headers: { Authorization: `Bearer ${token}`, "If-None-Match": "" }, cache: 'no-store'
    })
      .then((r) => {
          if (!r.ok) throw new Error("Not Found");
          return r.json();
      })
      .then((fileData) => {
        const text = base64ToUtf8(fileData.content.replace(/\n/g, ''));
        
        let dName = currentSession;
        const firstLine = text.split('\n')[0].trim();
        if (firstLine.startsWith("# display_name:")) {
            dName = firstLine.replace("# display_name:", "").trim();
        }
        setDisplayName(dName);

        setLines(parseTranscript(text));
        setActiveIndex(-1);
      })
      .catch(() => setLines([]))
      .finally(() => setLoading(false));

    // Find audio file and set source
    fetch(`https://api.github.com/repos/${user}/${repo}/contents/public/audio`, {
        headers: { Authorization: `Bearer ${token}` }
    })
      .then(r => r.json())
      .then(files => {
          if (!Array.isArray(files)) return;
          const match = files.find(f => f.name.startsWith(currentSession + '.'));
          if (match) {
              setAudioUrl(match.download_url);
              setIsPlaying(false);
              setCurrentTime(0);
              setDuration(0);
          }
      })
      .catch(e => console.error("Ses dosyası dizini alınamadı:", e));

  }, [currentSession, ghConfig]);

  // Track active line based on audio time
  const updateActiveLine = useCallback(() => {
    if (!audioRef.current || lines.length === 0) return;
    const time = audioRef.current.currentTime;
    setCurrentTime(time);

    let idx = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (time >= lines[i].time) {
        idx = i;
        break;
      }
    }
    setActiveIndex(idx);
  }, [lines]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => updateActiveLine();
    const onLoadedMetadata = () => setDuration(audio.duration);
    const onEnded = () => setIsPlaying(false);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);

    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
    };
  }, [updateActiveLine]);

  // Auto-scroll to active line
  useEffect(() => {
    if (activeIndex >= 0 && lineRefs.current[activeIndex]) {
      lineRefs.current[activeIndex].scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }
  }, [activeIndex]);

  useEffect(() => {
    if (displayName) {
      document.title = `${displayName} - Transkript`;
    } else if (currentSession) {
      document.title = `${currentSession} - Transkript`;
    }
  }, [currentSession, displayName]);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) audioRef.current.pause();
    else audioRef.current.play().catch(() => {});
  };

  const seekTo = (time) => {
    if (audioRef.current) {
      audioRef.current.currentTime = time;
    }
  };

  const handleSeek = (e) => {
    seekTo(parseFloat(e.target.value));
  };

  const handleSpeedChange = (s) => {
    setSpeed(s);
    if (audioRef.current) audioRef.current.playbackRate = s;
  };

  // Search logic
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setIsSearchOpen(true);
      }
      
      if (!isSearchOpen) return;

      if (e.key === 'Escape') {
        setIsSearchOpen(false);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedResultIndex((prev) => Math.min(prev + 1, searchResults.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedResultIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (selectedResultIndex >= 0 && selectedResultIndex < searchResults.length) {
            handleResultClick(searchResults[selectedResultIndex]);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSearchOpen, searchResults, selectedResultIndex]);

  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setSelectedResultIndex(-1);
      return;
    }
    const q = searchQuery.toLowerCase();
    const results = lines
      .map((line, index) => ({ ...line, originalIndex: index }))
      .filter((line) => line.text.toLowerCase().includes(q));
    setSearchResults(results);
    setSelectedResultIndex(results.length > 0 ? 0 : -1);
  }, [searchQuery, lines]);

  const handleResultClick = (result) => {
    setIsSearchOpen(false);
    seekTo(result.time);
    if (audioRef.current && audioRef.current.paused) {
      audioRef.current.play().catch(() => {});
    }
  };


  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-[#000000] text-gray-500 gap-4">
        <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
        <p className="text-lg">Oturum yükleniyor...</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-[#000000] overflow-hidden relative min-h-screen">
      {/* Background Image */}
      {!bgError && currentSession && ghConfig && (
        <div className="absolute inset-0 z-0 pointer-events-none">
          <img
            src={`https://raw.githubusercontent.com/${ghConfig.user}/${ghConfig.repo}/main/public/backgrounds/${currentSession}.jpg`}
            alt=""
            className="w-full h-full object-cover"
            onError={() => setBgError(true)}
          />
          <div className="absolute inset-0 backdrop-blur-[40px] bg-black/45"></div>
        </div>
      )}

      {/* Audio element (hidden) */}
      <audio ref={audioRef} src={audioUrl || undefined} preload="metadata" />

      {/* Top bar - Back button and Search */}
      <div className="absolute top-0 left-0 right-0 p-6 z-20 flex justify-between items-start pointer-events-none">
        <Link
          href="/"
          className="pointer-events-auto flex items-center gap-2 text-white text-sm font-semibold opacity-60 hover:opacity-100 hover:text-indigo-300 transition-all bg-black/30 px-3 py-1.5 rounded-full backdrop-blur-md border border-white/10"
        >
          <span>←</span> Oturumlar
        </Link>
        <button
          onClick={() => setIsSearchOpen(true)}
          className="pointer-events-auto flex items-center justify-center w-10 h-10 text-white opacity-60 hover:opacity-100 hover:text-indigo-300 transition-all bg-black/30 rounded-full backdrop-blur-md border border-white/10"
          title="Metinde Ara (Ctrl+F)"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </button>
      </div>
      
      {/* Small Session Title Top Center */}
      <div className="absolute top-0 left-0 right-0 p-6 flex justify-center z-10 pointer-events-none opacity-40">
        <span className="text-white text-xs font-bold tracking-widest uppercase truncate max-w-sm text-center">
          {displayName || currentSession}
        </span>
      </div>

      {/* Transcript Area */}
      <div
        ref={transcriptRef}
        className="flex-1 overflow-hidden touch-none no-scrollbar px-6 md:px-16 lg:px-32 py-[45vh] relative scroll-smooth pointer-events-none z-10"
      >
        {lines.length === 0 && !loading ? (
          <div className="text-center text-white/30 text-2xl font-bold">
            Transkript bulunamadı.
          </div>
        ) : (
          <div className="flex flex-col space-y-10 max-w-5xl mx-auto items-center">
            {lines.map((line, i) => {
              const distance = i - activeIndex;
              let visibilityClass = "";
              
              if (distance === 0) {
                visibilityClass = "text-white opacity-100 scale-105";
              } else if (distance === -1) {
                visibilityClass = "text-white opacity-25 scale-100";
              } else if (distance > 0 && distance <= 2) {
                visibilityClass = "text-white opacity-40 scale-100";
              } else {
                visibilityClass = "text-white opacity-0 scale-95";
              }

              const isVisible = Math.abs(distance) <= 2;

              return (
                <div
                  key={i}
                  ref={(el) => (lineRefs.current[i] = el)}
                  onClick={() => isVisible && seekTo(line.time)}
                  style={{ textShadow: "0 2px 12px rgba(0,0,0,0.9), 0 1px 4px rgba(0,0,0,0.8)" }}
                  className={`
                    transition-all duration-500 ease-in-out origin-center text-center mx-auto
                    text-3xl md:text-5xl lg:text-6xl font-bold tracking-tight leading-tight
                    ${isVisible ? "cursor-pointer pointer-events-auto" : "pointer-events-none"}
                    ${visibilityClass}
                  `}
                >
                  {line.text}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Bottom Bar (Controls) */}
      <div className="shrink-0 bg-gradient-to-t from-black via-black/90 to-transparent pt-12 pb-6 px-6 md:px-12 flex items-center gap-4 md:gap-6 z-20 absolute bottom-0 left-0 right-0 pointer-events-auto">
        <button
          onClick={togglePlay}
          className="w-12 h-12 flex items-center justify-center rounded-full bg-white text-black hover:scale-105 transition-transform shrink-0"
        >
          {isPlaying ? (
             <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
          ) : (
             <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" className="ml-1"><path d="M8 5v14l11-7z"/></svg>
          )}
        </button>
        
        <span className="text-xs text-white/50 font-mono shrink-0 w-10 text-right">{formatTime(currentTime)}</span>
        
        <div className="flex-1 flex items-center group">
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={currentTime}
            onChange={handleSeek}
            className="w-full h-1.5 bg-white/20 rounded-full appearance-none cursor-pointer group-hover:h-2 transition-all
              [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-0 [&::-webkit-slider-thumb]:h-0"
            style={{
              background: `linear-gradient(to right, white ${(currentTime / (duration || 1)) * 100}%, rgba(255,255,255,0.2) ${(currentTime / (duration || 1)) * 100}%)`
            }}
          />
        </div>
        
        <span className="text-xs text-white/50 font-mono shrink-0 w-10">{formatTime(duration)}</span>
        
        <div className="flex items-center gap-2 shrink-0 ml-2">
          <select 
            value={speed} 
            onChange={(e) => handleSpeedChange(parseFloat(e.target.value))}
            className="bg-transparent text-white/60 hover:text-white text-xs font-bold focus:outline-none cursor-pointer appearance-none text-center transition-colors"
          >
            {SPEEDS.map(s => <option key={s} value={s} className="bg-black text-white">{s}x</option>)}
          </select>
        </div>
      </div>

      {/* Search Overlay */}
      {isSearchOpen && (
        <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-lg flex flex-col items-center pt-24 px-4 pointer-events-auto">
          {/* Close Area */}
          <div className="absolute inset-0 z-0" onClick={() => setIsSearchOpen(false)}></div>
          
          <div className="relative z-10 w-full max-w-2xl flex flex-col gap-4">
            <input
              autoFocus
              type="text"
              placeholder="Metinde ara..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-[#111] border border-white/20 text-white px-6 py-4 rounded-2xl text-xl focus:outline-none focus:border-indigo-500 transition-colors shadow-2xl"
            />
            
            <div className="bg-[#111]/80 backdrop-blur-md border border-white/10 rounded-2xl overflow-hidden max-h-[60vh] flex flex-col shadow-2xl">
              <div className="overflow-y-auto no-scrollbar flex-1 p-2">
                {searchQuery.trim() && searchResults.length === 0 ? (
                  <div className="p-8 text-center text-gray-500">Sonuç bulunamadı</div>
                ) : (
                  searchResults.map((result, idx) => {
                    const isSelected = idx === selectedResultIndex;
                    // Highlight matching text
                    const lowerText = result.text.toLowerCase();
                    const lowerQuery = searchQuery.toLowerCase();
                    const startIndex = lowerText.indexOf(lowerQuery);
                    
                    let beforeMatch = result.text;
                    let matchText = "";
                    let afterMatch = "";

                    if (startIndex !== -1) {
                        beforeMatch = result.text.slice(0, startIndex);
                        matchText = result.text.slice(startIndex, startIndex + searchQuery.length);
                        afterMatch = result.text.slice(startIndex + searchQuery.length);
                    }

                    return (
                      <div
                        key={result.originalIndex}
                        onClick={() => handleResultClick(result)}
                        onMouseEnter={() => setSelectedResultIndex(idx)}
                        className={`flex items-center justify-between p-4 cursor-pointer rounded-xl transition-all ${
                          isSelected ? "bg-indigo-600/20 border border-indigo-500/30" : "hover:bg-white/5 border border-transparent"
                        }`}
                      >
                        <p className="text-white text-lg">
                          {startIndex !== -1 ? (
                            <>
                                {beforeMatch}
                                <span className="bg-indigo-500 text-white rounded px-0.5">{matchText}</span>
                                {afterMatch}
                            </>
                          ) : (
                              result.text
                          )}
                        </p>
                        <span className="text-indigo-300 font-mono text-sm opacity-60 ml-4 shrink-0">
                          {formatTime(result.time)}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function PlayerPage() {
  return (
    <Suspense fallback={<div className="flex-1 bg-black" />}>
      <PlayerContent />
    </Suspense>
  );
}
