"use client";

import { useState, useEffect } from "react";

const CACHE = {};
const queue = [];
let activeFetches = 0;

const enqueueFetch = (fn) => {
    return new Promise((resolve, reject) => {
        queue.push({ fn, resolve, reject });
        processQueue();
    });
};

const processQueue = async () => {
    if (activeFetches >= 5 || queue.length === 0) return;
    activeFetches++;
    const { fn, resolve, reject } = queue.shift();
    try {
        const result = await fn();
        resolve(result);
    } catch (e) {
        reject(e);
    } finally {
        activeFetches--;
        processQueue();
    }
};

export default function SessionStats({ session, ghConfig }) {
    const [stats, setStats] = useState(null);

    useEffect(() => {
        if (!ghConfig || !session) return;
        const cacheKey = `stats_${session.id}`;
        
        // Try sessionStorage
        const saved = sessionStorage.getItem(cacheKey);
        if (saved) {
            setStats(JSON.parse(saved));
            return;
        }

        // Try memory cache
        if (CACHE[cacheKey]) {
            setStats(CACHE[cacheKey]);
            return;
        }

        let isMounted = true;

        enqueueFetch(async () => {
            if (!isMounted) return null;
            const { user, repo, token } = ghConfig;
            
            // 1. Audio Duration
            let durationStr = "–";
            try {
                // Fetch audio list to get the URL
                const audioRes = await fetch(`https://api.github.com/repos/${user}/${repo}/contents/public/audio`, {
                    headers: { Authorization: `Bearer ${token}` }
                });
                if (audioRes.ok) {
                    const audioFiles = await audioRes.json();
                    if (Array.isArray(audioFiles)) {
                        const match = audioFiles.find(f => f.name.startsWith(session.id + '.'));
                        if (match) {
                            const audio = new Audio(match.download_url);
                            await new Promise((resolve) => {
                                audio.addEventListener('loadedmetadata', () => resolve());
                                audio.addEventListener('error', () => resolve());
                            });
                            if (audio.duration && !isNaN(audio.duration)) {
                                const sec = audio.duration;
                                const m = Math.floor(sec / 60);
                                const s = Math.floor(sec % 60);
                                durationStr = `${m}:${s.toString().padStart(2, "0")}`;
                            }
                        }
                    }
                }
            } catch (e) {}

            // 2. Total Lines
            let linesCount = "–";
            try {
                const txtRes = await fetch(`https://api.github.com/repos/${user}/${repo}/contents/public/transcripts/${session.id}.txt`, {
                    headers: { Authorization: `Bearer ${token}`, "If-None-Match": "" }
                });
                if (txtRes.ok) {
                    const fileData = await txtRes.json();
                    const text = decodeURIComponent(escape(atob(fileData.content.replace(/\n/g, ''))));
                    const lines = text.split("\n").filter(l => l.trim());
                    let count = 0;
                    for (const line of lines) {
                        const match = line.match(/^\[(\d{1,2}:)?(\d{2}):(\d{2})\]\s*(.*)/);
                        if (!match) continue;
                        const rawText = match[4];
                        const visibleText = rawText.replace(/\[.*?\]/g, "").replace(/\(.*?\)/g, "").trim();
                        if (visibleText.length > 0) count++;
                    }
                    linesCount = `${count} satır`;
                }
            } catch (e) {}

            // 3. Date Added
            let dateStr = "–";
            try {
                const dateRes = await fetch(`https://api.github.com/repos/${user}/${repo}/commits?path=public/transcripts/${session.id}.txt&per_page=1`, {
                    headers: { Authorization: `Bearer ${token}` }
                });
                if (dateRes.ok) {
                    const commits = await dateRes.json();
                    if (commits && commits.length > 0 && commits[0].commit?.author?.date) {
                        const d = new Date(commits[0].commit.author.date);
                        dateStr = d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' });
                    }
                }
            } catch (e) {}

            const result = { duration: durationStr, lines: linesCount, date: dateStr };
            CACHE[cacheKey] = result;
            try { sessionStorage.setItem(cacheKey, JSON.stringify(result)); } catch(e){}
            return result;
        }).then(result => {
            if (isMounted && result) setStats(result);
        });

        return () => { isMounted = false; };
    }, [session, ghConfig]);

    return (
        <div className="flex items-center gap-3 mt-1 text-[11px] font-medium text-white/50 pointer-events-none drop-shadow-md">
            <div className="flex items-center gap-1">
                <span>🕐</span>
                <span>{stats ? stats.duration : "–"}</span>
            </div>
            <div className="flex items-center gap-1">
                <span>📝</span>
                <span>{stats ? stats.lines : "–"}</span>
            </div>
            <div className="flex items-center gap-1">
                <span>📅</span>
                <span>{stats ? stats.date : "–"}</span>
            </div>
        </div>
    );
}
