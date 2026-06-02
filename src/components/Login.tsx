import React, { useState } from "react";
import { useApp } from "../AppContext";
import { motion } from "motion/react";
import { LogIn, Ship, UserPlus, ArrowLeft, Camera, Loader2, Eye, EyeOff } from "lucide-react";
import { compressImageToDataUrl } from "../lib/imageCompression";
import { uploadFile } from "../lib/serverStore";

type Mode = "login" | "signup";

export default function Login() {
  const { login, submitSignupRequest, refreshSignupEmployees } = useApp();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loadingSignupDb, setLoadingSignupDb] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showPwd2, setShowPwd2] = useState(false);

  // signup state
  const [name, setName] = useState("");
  const [nik, setNik] = useState("");
  const [pwd2, setPwd2] = useState("");
  const [photo, setPhoto] = useState("");
  const [signupOk, setSignupOk] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const success = await login(email, password);
    if (!success) setError("Email atau password salah.");
  };

  const handlePhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setError("");
    try {
      // Kompres dulu supaya file kecil, lalu coba upload ke server sebagai file fisik.
      // Kalau server tidak tersedia (preview/offline), fallback ke data URL base64.
      const dataUrl = await compressImageToDataUrl(f, { maxWidth: 1280, maxHeight: 1280, quality: 0.7 });
      const blob = await (await fetch(dataUrl)).blob();
      const url = await uploadFile(blob, { mode: 'public', filename: f.name.replace(/\.[^.]+$/, '') + '.jpg' });
      setPhoto(url || dataUrl);
    } catch (err) {
      setPhoto("");
      setError(err instanceof Error ? err.message : "Gagal memproses foto.");
    }
  };

  const openSignup = async () => {
    setError("");
    setLoadingSignupDb(true);
    try {
      await refreshSignupEmployees();
      setMode("signup");
    } finally {
      setLoadingSignupDb(false);
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!name.trim() || !nik.trim() || !pwd2.trim() || !photo) {
      setError("Semua kolom (termasuk foto) wajib diisi.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await submitSignupRequest({ name: name.trim(), nik: nik.trim(), password: pwd2, photo });
      if (!res.ok) {
        setError(res.error || "Gagal mengirim permintaan.");
        return;
      }
      setSignupOk(true);
      setName("");
      setNik("");
      setPwd2("");
      setPhoto("");
      setTimeout(() => {
        setSignupOk(false);
        setMode("login");
      }, 2200);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 p-6 font-sans">
      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="w-full max-w-sm bg-white rounded-2xl shadow-xl overflow-hidden"
      >
        <div className="bg-[var(--sidebar)] p-10 text-white flex flex-col items-center">
          <div className="w-12 h-12 bg-white/10 rounded-xl flex items-center justify-center mb-4">
            <Ship size={24} />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">FlukSite Pro</h1>
          <p className="text-[10px] uppercase tracking-widest text-gray-400 mt-1">Pintu Gerbang Keluar Masuk Site</p>
        </div>

        {mode === "login" ? (
          <form onSubmit={handleLogin} className="p-10 space-y-5">
            <div className="space-y-2">
              <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="NIK@gts.com"
                required
                className="w-full bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 pr-11 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Sembunyikan password" : "Tampilkan password"}
                  className="absolute inset-y-0 right-0 px-3 flex items-center text-gray-400 hover:text-gray-700"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              className="w-full bg-[var(--sidebar)] text-white py-3 rounded-lg font-bold text-sm hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
            >
              <span>Log In</span>
              <LogIn size={16} />
            </button>

            <button
              type="button"
              onClick={openSignup}
              disabled={loadingSignupDb}
              className="w-full border border-gray-200 text-gray-700 py-3 rounded-lg font-bold text-sm hover:bg-gray-50 transition-colors flex items-center justify-center gap-2"
            >
              {loadingSignupDb ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />}
              <span>{loadingSignupDb ? "Memuat database NIK..." : "Daftar"}</span>
            </button>

            {error && <p className="text-red-500 text-[10px] text-center font-medium">{error}</p>}
          </form>
        ) : (
          <form onSubmit={handleSignup} className="p-8 space-y-4">
            <button
              type="button"
              onClick={() => {
                setMode("login");
                setError("");
              }}
              className="text-[10px] uppercase font-black text-gray-400 hover:text-gray-700 flex items-center gap-1"
            >
              <ArrowLeft size={12} /> Kembali Login
            </button>
            <h2 className="font-black text-sm uppercase tracking-widest text-gray-900">Pendaftaran Akun Baru</h2>
            <p className="text-[10px] text-gray-500 leading-relaxed">
              Nama &amp; NIK harus sesuai dengan data karyawan yang sudah terdaftar. Pendaftaran tidak menambah karyawan
              baru — hanya membuat akses login.
            </p>

            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-gray-500 uppercase">Nama (sesuai ID Card)</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-gray-500 uppercase">NIK</label>
              <input
                value={nik}
                onChange={(e) => setNik(e.target.value)}
                required
                className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm"
              />
              {nik.trim() && (
                <p className="text-[10px] text-gray-500">
                  Email login Anda nanti: <span className="font-mono text-blue-700">{nik.trim()}@gts.com</span>
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-gray-500 uppercase">Password</label>
              <div className="relative">
                <input
                  type={showPwd2 ? "text" : "password"}
                  value={pwd2}
                  onChange={(e) => setPwd2(e.target.value)}
                  required
                  className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 pr-10 text-sm"
                />
                <button
                  type="button"
                  onClick={() => setShowPwd2((v) => !v)}
                  aria-label={showPwd2 ? "Sembunyikan password" : "Tampilkan password"}
                  className="absolute inset-y-0 right-0 px-3 flex items-center text-gray-400 hover:text-gray-700"
                >
                  {showPwd2 ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-gray-500 uppercase">Foto Selfie + ID Card</label>
              <label className="cursor-pointer flex items-center gap-2 px-3 py-2 bg-gray-50 border border-dashed border-gray-300 rounded-lg text-xs font-bold text-gray-600 hover:bg-gray-100">
                <Camera size={14} />
                <span>{photo ? "Ganti foto" : "Pilih file"}</span>
                <input type="file" accept="image/*" onChange={handlePhoto} className="hidden" />
              </label>
              {photo && <img src={photo} alt="preview" className="w-full h-32 object-cover rounded-lg mt-2" />}
            </div>

            <button
              type="submit"
              disabled={submitting}
              className={`w-full py-3 rounded-lg font-bold text-sm transition-opacity flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed ${
                signupOk ? "bg-green-600 text-white" : "bg-[var(--sidebar)] text-white hover:opacity-90"
              }`}
            >
              {submitting ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  <span>Memeriksa data...</span>
                </>
              ) : signupOk ? "Permintaan terkirim ✓" : "Kirim Permintaan"}
            </button>

            {signupOk && (
              <p className="text-[10px] text-green-700 text-center leading-relaxed">
                Setelah disetujui Superuser, login pakai email <span className="font-mono">{`{NIK}@gts.com`}</span>{" "}
                &amp; password yang Anda buat.
              </p>
            )}
            {error && <p className="text-red-500 text-[10px] text-center font-medium">{error}</p>}
          </form>
        )}

        <div className="px-10 pb-8 text-center">
          <p className="text-[9px] text-gray-400 uppercase leading-loose">
            Hanya Untuk Penggunaan Internal
            <br />© 2026 PT. GTS
          </p>
        </div>
      </motion.div>
    </div>
  );
}
