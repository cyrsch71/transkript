"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import SessionStats from "./components/SessionStats";

export default function Home() {
  const [sessions, setSessions] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortType, setSortType] = useState("yeni"); // 'yeni' | 'az'
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [ghConfig, setGhConfig] = useState(null);
  const [showDeleteModal, setShowDeleteModal] = useState(null); // session object to delete
  const [isDeleting, setIsDeleting] = useState(false);

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
              console.error("GitHub API Hata:", r.status, errBody);
              throw new Error(`GitHub API ${r.status}: ${errBody}`);
          }
          return r.json();
      })
      .then(async (data) => {
        if (!Array.isArray(data)) throw new Error("Dosyalar alınamadı.");
        const txtFiles = data
            .filter(f => f.name.endsWith(".txt"))
            .map(f => f.name.replace(".txt", ""));
        
        const sessionObjects = await Promise.all(txtFiles.map(async (id) => {
            try {
                const rawUrl = `https://raw.githubusercontent.com/${user}/${repo}/main/public/transcripts/${id}.txt`;
                const textRes = await fetch(rawUrl, { cache: 'no-store' });
                if (!textRes.ok) throw new Error();
                const text = await textRes.text();
                const firstLine = text.split('\n')[0].trim();
                let displayName = id;
                if (firstLine.startsWith("# display_name:")) {
                    displayName = firstLine.replace("# display_name:", "").trim();
                }
                return { id, displayName };
            } catch(e) {
                return { id, displayName: id };
            }
        }));

        setSessions(sessionObjects.reverse());
      })
      .catch((e) => {
          console.error("Kütüphane yükleme hatası:", e);
          setErrorMsg("Oturumlar yüklenemedi. GitHub bağlantısını kontrol edin.");
      })
      .finally(() => setLoading(false));
  }, []);

  const filteredAndSortedSessions = useMemo(() => {
    let result = [...sessions];
    
    // Filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(s => s.displayName.toLowerCase().includes(q) || s.id.toLowerCase().includes(q));
    }

    // Sort
    if (sortType === "az") {
      result.sort((a, b) => a.displayName.localeCompare(b.displayName));
    }
    // "yeni" is the default order from GitHub

    return result;
  }, [sessions, searchQuery, sortType]);

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
        ) : filteredAndSortedSessions.length === 0 ? (
          <div className="text-center py-20 text-gray-500 bg-[#222] rounded-2xl border border-white/5">
            <span className="text-4xl block mb-4">📭</span>
            Kayıtlı oturum bulunamadı.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {filteredAndSortedSessions.map(session => (
              <div key={session.id} className="relative group block outline-none rounded-2xl overflow-hidden bg-[#222] border border-white/5 shadow-lg hover:shadow-indigo-500/20 transition-all duration-300 aspect-video">
                <Link href={`/player?session=${encodeURIComponent(session.id)}`} className="absolute inset-0 z-10" />
                {/* Thumbnail */}
                {ghConfig && (
                  <img
                    src={`https://raw.githubusercontent.com/${ghConfig.user}/${ghConfig.repo}/main/public/backgrounds/${session.id}.jpg`}
                    alt={session.displayName}
                    className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                    onError={handleImageError}
                  />
                )}
                {/* Fallback Icon */}
                <div className="absolute inset-0 hidden items-center justify-center bg-gradient-to-br from-[#2a2a2a] to-[#111]">
                  <span className="text-4xl opacity-20 group-hover:opacity-40 transition-opacity duration-300 transform group-hover:scale-110">🎵</span>
                </div>

                {/* Gradient Overlay & Title */}
                <div className="absolute inset-x-0 bottom-0 pt-20 pb-4 px-5 bg-gradient-to-t from-black/90 via-black/50 to-transparent">
                  <h3 className="text-white font-bold text-lg truncate group-hover:text-indigo-300 transition-colors drop-shadow-md relative z-20 pointer-events-none">
                    {session.displayName}
                  </h3>
                  <SessionStats session={session} ghConfig={ghConfig} />
                </div>

                {/* Delete Button */}
                <button
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowDeleteModal(session); }}
                    className="absolute top-3 right-3 z-30 opacity-0 group-hover:opacity-100 bg-black/60 hover:bg-red-600 text-white w-8 h-8 rounded-full flex items-center justify-center backdrop-blur-md transition-all scale-90 hover:scale-110"
                    title="Oturumu Sil"
                >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

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
