"use client";

import { useState, useEffect, useRef } from "react";

export default function LazySessionMeta({ sessionId, ghConfig, onMetaLoaded }) {
    const ref = useRef(null);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        if (!ghConfig || loaded) return;
        const el = ref.current;
        if (!el) return;

        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    observer.disconnect();
                    const { user, repo, token } = ghConfig;
                    const apiUrl = `https://api.github.com/repos/${user}/${repo}/contents/public/transcripts/${sessionId}.txt`;
                    
                    fetch(apiUrl, { 
                        headers: { 
                            Authorization: `Bearer ${token}`,
                            Accept: "application/vnd.github.v3.raw"
                        },
                        cache: 'no-store' 
                    })
                        .then(r => r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`)))
                        .then(text => {
                            const lines = text.split('\n');
                            let displayName = sessionId;
                            let voiceActor = null;
                            let category = null;
                            let description = null;
                            let tags = [];
                            let originalLink = null;
                            let exactDuration = null;
                            
                            let total = 0;
                            let done = 0;
                            let lastTimestamp = 0;

                            for (const line of lines) {
                                const trimmed = line.trim();
                                if (!trimmed) continue;

                                if (trimmed.startsWith("# display_name:")) {
                                    displayName = trimmed.replace("# display_name:", "").trim();
                                } else if (trimmed.startsWith("# voice_actor:")) {
                                    voiceActor = trimmed.replace("# voice_actor:", "").trim() || null;
                                } else if (trimmed.startsWith("# category:")) {
                                    category = trimmed.replace("# category:", "").trim() || null;
                                } else if (trimmed.startsWith("# description:")) {
                                    description = trimmed.replace("# description:", "").trim() || null;
                                } else if (trimmed.startsWith("# tags:")) {
                                    const tagsStr = trimmed.replace("# tags:", "").trim();
                                    tags = tagsStr ? tagsStr.split(",").map(t => t.trim()).filter(Boolean) : [];
                                } else if (trimmed.startsWith("# original_link:")) {
                                    originalLink = trimmed.replace("# original_link:", "").trim() || null;
                                } else if (trimmed.startsWith("# audio_duration:")) {
                                    exactDuration = trimmed.replace("# audio_duration:", "").trim() || null;
                                } else if (!trimmed.startsWith("#")) {
                                    total++;
                                    const match = trimmed.match(/^\[(?:(\d{1,2}):)?(\d{2}):(\d{2})\]/);
                                    if (match) {
                                        done++;
                                        let h = match[1] ? parseInt(match[1]) : 0;
                                        let m = parseInt(match[2]);
                                        let s = parseInt(match[3]);
                                        lastTimestamp = h * 3600 + m * 60 + s;
                                    }
                                }
                            }

                            let durationStr = exactDuration || "–";
                            if (!exactDuration && lastTimestamp > 0) {
                                let m = Math.floor(lastTimestamp / 60);
                                let s = lastTimestamp % 60;
                                durationStr = `${m}:${s.toString().padStart(2, "0")}`;
                            }

                            setLoaded(true);
                            onMetaLoaded({ 
                                id: sessionId, 
                                displayName, 
                                voiceActor, 
                                category,
                                description,
                                tags,
                                originalLink,
                                total,
                                done,
                                durationStr,
                                linesCount: `${total} satır`
                            });
                        })
                        .catch(() => {
                            setLoaded(true);
                            onMetaLoaded({ 
                                id: sessionId, 
                                displayName: sessionId, 
                                voiceActor: null, 
                                category: null,
                                description: null,
                                tags: [],
                                originalLink: null,
                                total: 0,
                                done: 0,
                                durationStr: "–",
                                linesCount: "–"
                            });
                        });
                }
            },
            { rootMargin: "200px" }
        );

        observer.observe(el);
        return () => observer.disconnect();
    }, [ghConfig, sessionId, loaded, onMetaLoaded]);

    return <span ref={ref} className="absolute top-0 left-0 w-px h-px opacity-0 pointer-events-none" />;
}
