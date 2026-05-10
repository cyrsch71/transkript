"use client";

import { useState, useEffect, useRef, useMemo, useCallback, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import LazySessionMeta from "./components/LazySessionMeta";

function HomeContent() {
  const searchParams = useSearchParams();
  const [sessions, setSessions] = useState([]);
  const [metaMap, setMetaMap] = useState({}); // { id: { displayName, voiceActor, category } }
  const [searchQuery, setSearchQuery] = useState("");
  const [sortType, setSortType] = useState("yeni"); // 'yeni' | 'az'
  const [filterVoiceActor, setFilterVoiceActor] = useState(searchParams.get("voice_actor") || ""); // "" = Tümü
  const [filterCategory, setFilterCategory] = useState(searchParams.get("category") || ""); // "" = Tümü
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [ghConfig, setGhConfig] = useState(null);
  const [showDeleteModal, setShowDeleteModal] = useState(null); // session object to delete
  const [isDeleting, setIsDeleting] = useState(false);

  const handleMetaLoaded = useCallback((meta) => {
      setMetaMap(prev => ({ ...prev, [meta.id]: meta }));
  }, []);

  useEffect(() => {
    const token = localStorage.getItem("gh_token");
    const user = localStorage.getItem("gh_user");
    const repo = localStorage.getItem("gh_repo");
    
    if (!token || !user || !repo) {
        setLoading(false);
        setErrorMsg("Lütfen sağ üstteki Ayarlar (⚙) ikonundan GitHub bilgilerinizi girin.");
        return;
    }

    setGhConfig({ user, repo, token });

    setLoading(true);
    // Only fetch the directory listing — NO individual file contents
    fetch(`https://api.github.com/repos/${user}/${repo}/contents/public/transcripts`, {
        headers: { 
            Authorization: `Bearer ${token}`,
            "If-None-Match": ""
        },
        cache: 'no-store'
    })
      .then(async (r) => {
          if (!r.ok) {
              const errBody = await r.text();
              if (r.status === 401) {
                  throw new Error("TOKEN_EXPIRED");
              }
              throw new Error(`GitHub API ${r.status}: ${errBody}`);
          }
          return r.json();
      })
      .then((data) => {
        if (!Array.isArray(data)) throw new Error("Dosyalar alınamadı.");
        const txtFiles = data
            .filter(f => f.name.endsWith(".txt") && f.name !== "sessions.json")
            .map(f => f.name.replace(".txt", ""));
        
        // Just create lightweight session objects with ID only.
        // Metadata (displayName, voiceActor, category) will be lazy-loaded
        // per card when it scrolls into view.
        const sessionObjects = txtFiles.map(id => ({ id }));
        setSessions(sessionObjects.reverse());
      })
      .catch((e) => {
          if (e.message === "TOKEN_EXPIRED") {
              setErrorMsg("GitHub token geçersiz veya süresi dolmuş. Sağ üstteki ⚙ ikonundan yeni token girin.");
          } else {
              console.error("Kütüphane yükleme hatası:", e);
              setErrorMsg("Oturumlar yüklenemedi. GitHub bağlantısını kontrol edin.");
          }
      })
      .finally(() => setLoading(false));
  }, []);

  // Build unique voice actor and category lists from lazy-loaded metadata
  const uniqueVoiceActors = useMemo(() => {
    const actors = new Set();
    Object.values(metaMap).forEach(m => { if (m.voiceActor) actors.add(m.voiceActor); });
    return [...actors].sort((a, b) => a.localeCompare(b));
  }, [metaMap]);

  const uniqueCategories = useMemo(() => {
    const cats = new Set();
    Object.values(metaMap).forEach(m => { if (m.category) cats.add(m.category); });
    return [...cats].sort((a, b) => a.localeCompare(b));
  }, [metaMap]);

  const filteredAndSortedSessions = useMemo(() => {
    let result = [...sessions];
    
    // Text search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(s => {
        const meta = metaMap[s.id];
        const name = meta ? meta.displayName : s.id;
        return name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q);
      });
    }

    // Voice actor filter
    if (filterVoiceActor) {
      result = result.filter(s => {
        const meta = metaMap[s.id];
        return meta && meta.voiceActor === filterVoiceActor;
      });
    }

    // Category filter
    if (filterCategory) {
      result = result.filter(s => {
        const meta = metaMap[s.id];
        return meta && meta.category === filterCategory;
      });
    }

    // Sort
    if (sortType === "az") {
      result.sort((a, b) => {
        const nameA = metaMap[a.id]?.displayName || a.id;
        const nameB = metaMap[b.id]?.displayName || b.id;
        return nameA.localeCompare(nameB);
      });
    }
    // "yeni" is the default order from GitHub

    return result;
  }, [sessions, metaMap, searchQuery, sortType, filterVoiceActor, filterCategory]);

  const isFilteringLoading = (filterVoiceActor || filterCategory || searchQuery.trim()) && sessions.some(s => !metaMap[s.id]);

  // Background fetcher for filtering/searching
  useEffect(() => {
    if (!filterVoiceActor && !filterCategory && !searchQuery.trim()) return;
    if (!ghConfig || sessions.length === 0) return;

    const unloadedSessions = sessions.filter(s => !metaMap[s.id]);
    if (unloadedSessions.length === 0) return; // All loaded!

    let isCancelled = false;

    const fetchQueue = async () => {
      // Chunk size of 3 to avoid GitHub API rate limits
      for (let i = 0; i < unloadedSessions.length; i += 3) {
        if (isCancelled) break;
        const chunk = unloadedSessions.slice(i, i + 3);
        await Promise.all(chunk.map(async (s) => {
          try {
            const url = `https://api.github.com/repos/${ghConfig.user}/${ghConfig.repo}/contents/public/transcripts/${s.id}.txt`;
            const res = await fetch(url, {
              headers: { Authorization: `Bearer ${ghConfig.token}`, Accept: "application/vnd.github.v3.raw" },
              cache: "no-store"
            });
            if (res.ok) {
              const text = await res.text();
              const lines = text.split("\n");
              let dName = s.id, vActor = "", cat = "", durStr = "–", exactDuration = null, total = 0, lastTimestamp = 0;
              let tgs = [];

              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                if (trimmed.startsWith("# display_name:")) { dName = trimmed.replace("# display_name:", "").trim(); }
                else if (trimmed.startsWith("# voice_actor:")) { vActor = trimmed.replace("# voice_actor:", "").trim(); }
                else if (trimmed.startsWith("# category:")) { cat = trimmed.replace("# category:", "").trim(); }
                else if (trimmed.startsWith("# tags:")) {
                    const tagsStr = trimmed.replace("# tags:", "").trim();
                    tgs = tagsStr ? tagsStr.split(",").map(t => t.trim()).filter(Boolean) : [];
                }
                else if (trimmed.startsWith("# audio_duration:")) {
                    exactDuration = trimmed.replace("# audio_duration:", "").trim();
                }
                else if (!trimmed.startsWith("#")) {
                  total++;
                  const match = trimmed.match(/^\[(?:(\d{1,2}):)?(\d{2}):(\d{2})\]/);
                  if (match) {
                    let h = match[1] ? parseInt(match[1]) : 0;
                    let m = parseInt(match[2]);
                    let sec = parseInt(match[3]);
                    lastTimestamp = h * 3600 + m * 60 + sec;
                  }
                }
              }
              durStr = exactDuration || "–";
              if (!exactDuration && lastTimestamp > 0) {
                let m = Math.floor(lastTimestamp / 60);
                let sec = lastTimestamp % 60;
                durStr = `${m}:${sec.toString().padStart(2, "0")}`;
              }

              handleMetaLoaded({
                id: s.id,
                displayName: dName,
                voiceActor: vActor,
                category: cat,
                durationStr: durStr,
                linesCount: String(total),
                tags: tgs
              });
            } else {
              handleMetaLoaded({ id: s.id, displayName: s.id, voiceActor: "", category: "", error: true });
            }
          } catch (e) {
            handleMetaLoaded({ id: s.id, displayName: s.id, voiceActor: "", category: "", error: true });
          }
        }));
      }
    };

    fetchQueue();

    return () => { isCancelled = true; };
  }, [filterVoiceActor, filterCategory, searchQuery, ghConfig, sessions, metaMap, handleMetaLoaded]);

  const handleDelete = async () => {
      if (!showDeleteModal || !ghConfig) return;
      setIsDeleting(true);
      const { user, repo } = ghConfig;
      const token = localStorage.getItem("gh_token");
      const { id } = showDeleteModal;

      const deleteFile = async (path) => {
          const url = `https://api.github.com/repos/${user}/${repo}/contents/${encodeURI(path)}`;
          const res = await fetch(url, {
              headers: { Authorization: `Bearer ${token}`, "If-None-Match": "" }, cache: "no-store"
          });
          if (res.status === 404) return; // Zaten yok
          if (!res.ok) {
              const err = await res.text();
              throw new Error(`${path} okunamadı: ${err}`);
          }
          const data = await res.json();
          if (data && data.sha) {
              const delRes = await fetch(url, {
                  method: "DELETE",
                  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                  body: JSON.stringify({ message: `Oturum silindi: ${path}`, sha: data.sha })
              });
              if (!delRes.ok) {
                  const err = await delRes.text();
                  throw new Error(`${path} silinemedi: ${err}`);
              }
          }
      };

      try {
          await Promise.all([
              deleteFile(`public/transcripts/${id}.txt`),
              deleteFile(`public/backgrounds/${id}.jpg`)
          ]);

          const audioRes = await fetch(`https://api.github.com/repos/${user}/${repo}/contents/public/audio`, {
              headers: { Authorization: `Bearer ${token}`, "If-None-Match": "" }, cache: "no-store"
          });
          if (audioRes.ok) {
              const audioFiles = await audioRes.json();
              if (Array.isArray(audioFiles)) {
                  const match = audioFiles.find(f => f.name.startsWith(id + '.'));
                  if (match) {
                      const delRes = await fetch(`https://api.github.com/repos/${user}/${repo}/contents/${encodeURI(match.path)}`, {
                          method: "DELETE",
                          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                          body: JSON.stringify({ message: `Oturum silindi: ${match.name}`, sha: match.sha })
                      });
                      if (!delRes.ok) throw new Error("Ses dosyası silinemedi");
                  }
              }
          }

          // Update sessions.json to remove it
          try {
              const sessionsUrl = `https://api.github.com/repos/${user}/${repo}/contents/public/transcripts/sessions.json`;
              const sRes = await fetch(sessionsUrl, { 
                  headers: { Authorization: `Bearer ${token}`, "If-None-Match": "" }, cache: "no-store" 
              });
              if (sRes.ok) {
                  const sData = await sRes.json();
                  const content = decodeURIComponent(escape(atob(sData.content.replace(/\n/g, ''))));
                  let sList = JSON.parse(content);
                  if (sList.includes(id)) {
                      sList = sList.filter(s => s !== id);
                      const newContent = btoa(unescape(encodeURIComponent(JSON.stringify(sList, null, 2))));
                      await fetch(sessionsUrl, {
                          method: "PUT",
                          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                          body: JSON.stringify({ message: `Oturum silindi (JSON): ${id}`, content: newContent, sha: sData.sha })
                      });
                  }
              }
          } catch(e) {
              console.warn("sessions.json güncellenirken hata:", e);
          }

          setSessions(prev => prev.filter(s => s.id !== id));
          setShowDeleteModal(null);
      } catch(e) {
          console.error(e);
          alert("Silme işlemi başarısız oldu:\n" + e.message);
      } finally {
          setIsDeleting(false);
      }
  };

  const handleImageError = (e) => {
    // Hide the image, show the fallback icon
    e.target.style.display = "none";
    if (e.target.nextElementSibling) {
      e.target.nextElementSibling.style.display = "flex";
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 md:p-10 lg:p-12 bg-[#1a1a1a]">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Header Section */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <h1 className="text-3xl md:text-4xl font-bold text-white tracking-tight">Oturumlar</h1>
          
          <div className="flex flex-col sm:flex-row items-center gap-4">
            {/* Search */}
            <div className="relative w-full sm:w-64">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">🔍</span>
              <input
                type="text"
                placeholder="Oturum ara..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-[#262626] border border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all placeholder:text-gray-500"
              />
            </div>
            
            {/* Sort Buttons */}
            <div className="flex items-center gap-1 bg-[#262626] p-1 rounded-xl border border-white/10 w-full sm:w-auto">
              <button
                onClick={() => setSortType("yeni")}
                className={`flex-1 sm:flex-none px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${sortType === "yeni" ? "bg-indigo-600 text-white" : "text-gray-400 hover:text-white"}`}
              >
                Yeni
              </button>
              <button
                onClick={() => setSortType("az")}
                className={`flex-1 sm:flex-none px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${sortType === "az" ? "bg-indigo-600 text-white" : "text-gray-400 hover:text-white"}`}
              >
                A-Z
              </button>
            </div>
          </div>
        </div>

        {/* Filter Dropdowns */}
        {(uniqueVoiceActors.length > 0 || uniqueCategories.length > 0) && (
          <div className="flex flex-wrap items-center gap-3">
            {uniqueVoiceActors.length > 0 && (
              <div className="relative">
                <select
                  value={filterVoiceActor}
                  onChange={(e) => setFilterVoiceActor(e.target.value)}
                  className="appearance-none bg-[#262626] border border-white/10 rounded-xl pl-4 pr-9 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all cursor-pointer"
                >
                  <option value="">🎙 Seslendiren: Tümü</option>
                  {uniqueVoiceActors.map(va => (
                    <option key={va} value={va}>{va}</option>
                  ))}
                </select>
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-xs pointer-events-none">▼</span>
              </div>
            )}
            {uniqueCategories.length > 0 && (
              <div className="relative">
                <select
                  value={filterCategory}
                  onChange={(e) => setFilterCategory(e.target.value)}
                  className="appearance-none bg-[#262626] border border-white/10 rounded-xl pl-4 pr-9 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all cursor-pointer"
                >
                  <option value="">🏷 Kategori: Tümü</option>
                  {uniqueCategories.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-xs pointer-events-none">▼</span>
              </div>
            )}
            {(filterVoiceActor || filterCategory) && (
              <button
                onClick={() => { setFilterVoiceActor(""); setFilterCategory(""); }}
                className="px-3 py-2 text-xs font-medium text-gray-400 hover:text-white bg-[#262626] border border-white/10 rounded-xl hover:border-red-500/50 transition-all"
              >
                ✕ Filtreleri Temizle
              </button>
            )}
          </div>
        )}

        {/* Grid Section */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400 space-y-4">
            <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
            <p>Oturumlar yükleniyor...</p>
          </div>
        ) : errorMsg ? (
          <div className="text-center py-20 text-red-400 bg-red-950/20 rounded-2xl border border-red-900/30">
            <span className="text-4xl block mb-4">⚠️</span>
            {errorMsg}
          </div>
        ) : isFilteringLoading ? (
          <div className="flex flex-col items-center justify-center py-20 text-indigo-400 space-y-4 bg-[#222] rounded-2xl border border-white/5">
            <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
            <p className="font-medium">Oturum bilgileri taranıyor...</p>
          </div>
        ) : filteredAndSortedSessions.length === 0 ? (
          <div className="text-center py-20 text-gray-500 bg-[#222] rounded-2xl border border-white/5">
            <span className="text-4xl block mb-4">{(filterVoiceActor || filterCategory || searchQuery.trim()) ? "🔍" : "📭"}</span>
            {(filterVoiceActor || filterCategory || searchQuery.trim()) ? "Eşleşen oturum bulunamadı." : "Kayıtlı oturum bulunamadı."}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {filteredAndSortedSessions.map(session => {
              const meta = metaMap[session.id];
              const displayName = meta?.displayName || session.id;
              const voiceActor = meta?.voiceActor;
              const category = meta?.category;
              return (
              <div key={session.id} className="relative group block outline-none rounded-2xl overflow-hidden bg-[#222] border border-white/5 shadow-lg hover:shadow-indigo-500/20 transition-all duration-300 aspect-video">
                <Link href={`/session/${encodeURIComponent(session.id)}`} className="absolute inset-0 z-10" />
                {/* Lazy metadata loader */}
                <LazySessionMeta sessionId={session.id} ghConfig={ghConfig} onMetaLoaded={handleMetaLoaded} />
                {/* Thumbnail */}
                {ghConfig && (
                  <img
                    src={`https://raw.githubusercontent.com/${ghConfig.user}/${ghConfig.repo}/main/public/backgrounds/${session.id}.jpg`}
                    alt={displayName}
                    className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                    onError={handleImageError}
                  />
                )}
                {/* Fallback Icon */}
                <div className="absolute inset-0 hidden items-center justify-center bg-gradient-to-br from-[#2a2a2a] to-[#111]">
                  <span className="text-4xl opacity-20 group-hover:opacity-40 transition-opacity duration-300 transform group-hover:scale-110">🎵</span>
                </div>

                {/* Voice Actor & Category Tags (Top Left) */}
                {(voiceActor || category) && (
                  <div className="absolute top-3 left-3 z-20 flex flex-col items-start gap-2 pointer-events-none">
                    {voiceActor && (
                      <div className="flex items-center gap-1.5 bg-purple-600/90 text-white px-2.5 py-1 rounded-xl text-xs font-semibold backdrop-blur-md shadow-lg shadow-black/30 border border-white/10">
                        <span>🎙</span>
                        <span className="truncate max-w-[130px]">{voiceActor}</span>
                      </div>
                    )}
                    {category && (
                      <div className="flex items-center gap-1.5 bg-yellow-400/90 text-yellow-950 px-2.5 py-1 rounded-xl text-xs font-bold backdrop-blur-md shadow-lg shadow-black/30 border border-white/20">
                        <span>🏷️</span>
                        <span className="truncate max-w-[130px]">{category}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Gradient Overlay & Title */}
                <div className="absolute inset-x-0 bottom-0 pt-20 pb-4 px-5 bg-gradient-to-t from-black/90 via-black/50 to-transparent">
                  <h3 className="text-white font-bold text-lg truncate group-hover:text-indigo-300 transition-colors drop-shadow-md relative z-20 pointer-events-none">
                    {displayName}
                  </h3>
                  {/* Duration and Tags Stats */}
                  <div className="flex items-center justify-between mt-1 text-[11px] font-medium text-white/50 pointer-events-none drop-shadow-md relative z-20 w-full">
                      <div className="flex items-center gap-1 shrink-0">
                          <span>🕐</span>
                          <span>{meta?.durationStr || "–"}</span>
                      </div>
                      
                      {/* Tags area */}
                      {meta?.tags && meta.tags.length > 0 && (
                          <div className="flex flex-wrap items-start justify-end gap-1.5 ml-auto max-w-[65%] h-[20px] overflow-hidden">
                              {meta.tags.map((tag, idx) => (
                                  <span key={idx} className="bg-black/60 text-white px-2 py-[2px] rounded-full text-[11px] whitespace-nowrap border border-white/10 shadow-sm backdrop-blur-sm">
                                      {tag}
                                  </span>
                              ))}
                          </div>
                      )}
                  </div>
                </div>

                {/* Delete Button */}
                <button
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowDeleteModal({ id: session.id, displayName }); }}
                    className="absolute top-3 right-3 z-30 opacity-0 group-hover:opacity-100 bg-black/60 hover:bg-red-600 text-white w-8 h-8 rounded-full flex items-center justify-center backdrop-blur-md transition-all scale-90 hover:scale-110"
                    title="Oturumu Sil"
                >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                </button>
              </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Active Filter Banner */}
      {(filterVoiceActor || filterCategory) && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-indigo-600/90 backdrop-blur-md text-white px-5 py-2.5 rounded-full text-sm font-medium flex items-center gap-3 shadow-xl border border-indigo-400/30">
          <span>
            {filterVoiceActor && `🎙 ${filterVoiceActor}`}
            {filterVoiceActor && filterCategory && " · "}
            {filterCategory && `🏷 ${filterCategory}`}
          </span>
          <button
            onClick={() => { setFilterVoiceActor(""); setFilterCategory(""); window.history.replaceState({}, "", "/"); }}
            className="text-white/70 hover:text-white text-xs ml-1"
          >
            ✕
          </button>
        </div>
      )}

      {/* Delete Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="bg-[#1a1a1a] border border-white/10 rounded-2xl p-6 max-w-md w-full shadow-2xl text-center">
                <div className="w-16 h-16 bg-red-950/50 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4 border border-red-900/50">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                </div>
                <h3 className="text-xl font-bold text-white mb-2">Bu oturumu silmek istediğinden emin misin?</h3>
                <p className="text-gray-400 mb-6 font-medium">"{showDeleteModal.displayName}" kalıcı olarak silinecek.</p>
                <div className="flex justify-center gap-3">
                    <button
                        onClick={() => setShowDeleteModal(null)}
                        disabled={isDeleting}
                        className="px-5 py-2.5 rounded-xl font-medium text-gray-400 hover:text-white hover:bg-white/5 transition-colors disabled:opacity-50"
                    >
                        İptal
                    </button>
                    <button
                        onClick={handleDelete}
                        disabled={isDeleting}
                        className="px-5 py-2.5 rounded-xl font-medium text-white bg-red-600 hover:bg-red-500 transition-colors disabled:opacity-50 flex items-center gap-2"
                    >
                        {isDeleting ? "Siliniyor..." : "Evet, Sil"}
                    </button>
                </div>
            </div>
        </div>
      )}
    </div>
  );
}

export default function Home() {
  return (
    <Suspense fallback={
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-gray-400">
        <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mb-4"></div>
        Yükleniyor...
      </div>
    }>
      <HomeContent />
    </Suspense>
  );
}
