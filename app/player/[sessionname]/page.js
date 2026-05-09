"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
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

export default function PlayerPage() {
  const params = useParams();
  const currentSession = params.sessionname ? decodeURIComponent(params.sessionname) : "";

  const [lines, setLines] = useState([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [loading, setLoading] = useState(true);
  const [bgError, setBgError] = useState(false);

  const audioRef = useRef(null);
  const transcriptRef = useRef(null);
  const lineRefs = useRef([]);

  // Load transcript when session changes
  useEffect(() => {
    if (!currentSession) return;
    setLoading(true);
    setBgError(false);
    fetch(`/transcripts/${currentSession}.txt`)
      .then((r) => r.text())
      .then((text) => {
        setLines(parseTranscript(text));
        setActiveIndex(-1);
      })
      .catch(() => setLines([]))
      .finally(() => setLoading(false));

    // Update audio source
    if (audioRef.current) {
      audioRef.current.src = `/audio/${currentSession}.mp3`;
      audioRef.current.load();
      setIsPlaying(false);
      setCurrentTime(0);
      setDuration(0);
    }
  }, [currentSession]);

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
    if (currentSession) {
      document.title = `${currentSession} - Transkript`;
    }
  }, [currentSession]);

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

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500 text-lg bg-[#000000]">
        Yükleniyor...
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-[#000000] overflow-hidden relative min-h-screen">
      {/* Background Image */}
      {!bgError && currentSession && (
        <div className="absolute inset-0 z-0 pointer-events-none">
          <img
            src={`/backgrounds/${currentSession}.jpg`}
            alt=""
            className="w-full h-full object-cover"
            onError={() => setBgError(true)}
          />
          <div className="absolute inset-0 backdrop-blur-[40px] bg-black/45"></div>
        </div>
      )}

      {/* Audio element (hidden) */}
      <audio ref={audioRef} preload="metadata" />

      {/* Top bar - Minimal, low opacity, back button */}
      <div className="absolute top-0 left-0 p-6 z-20 opacity-60 hover:opacity-100 transition-opacity duration-300">
        <Link
          href="/"
          className="flex items-center gap-2 text-white text-sm font-semibold hover:text-indigo-300 transition-colors bg-black/30 px-3 py-1.5 rounded-full backdrop-blur-md border border-white/10"
        >
          <span>←</span> Oturumlar
        </Link>
      </div>
      
      {/* Small Session Title Top Center */}
      <div className="absolute top-0 left-0 right-0 p-6 flex justify-center z-10 pointer-events-none opacity-40">
        <span className="text-white text-xs font-bold tracking-widest uppercase">
          {currentSession}
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
    </div>
  );
}
