"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export default function Navbar() {
  const [showModal, setShowModal] = useState(false);
  const [token, setToken] = useState("");
  const [user, setUser] = useState("");
  const [repo, setRepo] = useState("");
  const [isLoaded, setIsLoaded] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const gh_token = localStorage.getItem("gh_token");
    const gh_user = localStorage.getItem("gh_user");
    const gh_repo = localStorage.getItem("gh_repo");

    if (gh_token) setToken(gh_token);
    if (gh_user) setUser(gh_user);
    if (gh_repo) setRepo(gh_repo);

    setIsLoaded(true);

    // İlk giriş ise ve bilgiler eksikse modalı aç
    if (!gh_token || !gh_user || !gh_repo) {
      setShowModal(true);
    }
  }, []);

  const handleSave = () => {
    localStorage.setItem("gh_token", token.trim());
    localStorage.setItem("gh_user", user.trim());
    localStorage.setItem("gh_repo", repo.trim());
    setShowModal(false);
  };

  const handleReset = () => {
    localStorage.removeItem("gh_token");
    localStorage.removeItem("gh_user");
    localStorage.removeItem("gh_repo");
    setToken("");
    setUser("");
    setRepo("");
  };

  if (!isLoaded) return null; // Avoid hydration mismatch

  if (pathname && pathname.startsWith("/player")) return null;

  return (
    <>
      <nav className="flex items-center gap-6 px-6 py-3 bg-[#111] border-b border-white/10 shrink-0">
        <span className="text-lg font-bold tracking-tight text-indigo-400 mr-4 select-none">
          Transkript
        </span>
        <Link
          href="/"
          className="flex items-center gap-1.5 text-sm font-medium text-gray-300 hover:text-indigo-400 transition-colors"
        >
          <span>▶</span> Kütüphane
        </Link>
        <Link
          href="/editor"
          className="flex items-center gap-1.5 text-sm font-medium text-gray-300 hover:text-indigo-400 transition-colors"
        >
          <span>✏</span> Editör
        </Link>
        <div className="flex-1" />
        <button
          onClick={() => setShowModal(true)}
          className="text-gray-400 hover:text-white transition-colors"
          title="Ayarlar"
        >
          ⚙
        </button>
      </nav>

      {/* Ayarlar Modalı */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-[#222] border border-white/10 rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <h2 className="text-xl font-bold text-white mb-4">GitHub Ayarları</h2>
            <p className="text-sm text-gray-400 mb-6">
              Transkriptleri ve ses dosyalarını doğrudan deponuza yükleyebilmek için GitHub bilgilerinizi girin. Bu bilgiler sadece tarayıcınızda (localStorage) saklanır.
            </p>
            
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">
                  GitHub Personal Access Token (repo yetkili)
                </label>
                <input
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  className="w-full bg-[#111] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                  placeholder="ghp_..."
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">
                  GitHub Kullanıcı Adı
                </label>
                <input
                  type="text"
                  value={user}
                  onChange={(e) => setUser(e.target.value)}
                  className="w-full bg-[#111] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                  placeholder="ornek-kullanici"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">
                  Repository (Depo) Adı
                </label>
                <input
                  type="text"
                  value={repo}
                  onChange={(e) => setRepo(e.target.value)}
                  className="w-full bg-[#111] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                  placeholder="transkript-uygulamasi"
                />
              </div>
            </div>

            <div className="mt-8 flex items-center justify-between">
              <button
                onClick={handleReset}
                className="text-sm text-red-400 hover:text-red-300 transition-colors"
              >
                Ayarları Sıfırla
              </button>
              <div className="flex gap-3">
                {token && user && repo && (
                  <button
                    onClick={() => setShowModal(false)}
                    className="px-4 py-2 rounded-lg text-sm font-medium text-gray-300 hover:bg-white/5 transition-colors"
                  >
                    Kapat
                  </button>
                )}
                <button
                  onClick={handleSave}
                  disabled={!token || !user || !repo}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Kaydet
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
