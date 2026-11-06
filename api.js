/**
 * api.js — Lapisan API terpusat untuk SiapTKA
 * ============================================
 * SATU-SATUNYA file yang tahu cara memanggil backend GAS.
 * Semua halaman (guru.html, murid.html, admin.html) WAJIB memakai
 * fungsi di file ini. Jangan panggil fetch/JSONP langsung dari halaman.
 *
 * Jika nanti migrasi ke Supabase/Firebase: cukup ubah isi fungsi
 * _request() di bawah. Signature fungsi publik tetap sama.
 *
 * Pemakaian:
 *   await API.teacherLogin(email, password)
 *   await API.createClass({ teacher_id, nama_kelas, ... })
 */

(function (global) {
  'use strict';

  // ==========================================
  // KONFIGURASI
  // ==========================================
  var GAS_URL = "https://script.google.com/macros/s/AKfycbwYQpw801zHrr34qNaAjTkIRxDLXR_3ieFvH_MH8QrtcqARqcflzlbbtc8twn-1rtD4/exec";

  // Simpan identitas login guru agar tidak hilang saat refresh
  var STORAGE_KEY = 'siaptka_guru_session';

  // ==========================================
  // CORE: JSONP request (satu-satunya titik ke backend)
  // ==========================================
  /**
   * Kirim request ke GAS via JSONP.
   * @param {string} action  - nama aksi backend (mis. 'login', 'createClass')
   * @param {object} params  - parameter tambahan (key-value)
   * @returns {Promise<object>} - resolve dengan objek response dari GAS
   */
  function _request(action, params) {
    return new Promise(function (resolve, reject) {
      var callbackName = 'jsonp_' + Math.round(1e9 * Math.random()) + '_' + Date.now();
      var script = document.createElement('script');
      var timeoutId = null;

      function cleanup() {
        if (timeoutId) clearTimeout(timeoutId);
        if (script && script.parentNode) script.parentNode.removeChild(script);
        try { delete global[callbackName]; } catch (e) { global[callbackName] = undefined; }
      }

      global[callbackName] = function (response) {
        cleanup();
        if (response && response.ok === false) {
          // Bukan error teknis — error bisnis (password salah, dll).
          // Tetap resolve agar halaman bisa tampilkan pesan dengan tenang.
          resolve(response);
        } else {
          resolve(response);
        }
      };

      script.onerror = function () {
        cleanup();
        reject(new Error('NETWORK_ERROR'));
      };

      var qs = 'action=' + encodeURIComponent(action) +
               '&callback=' + encodeURIComponent(callbackName) +
               '&_=' + Date.now(); // anti-cache

      if (params) {
        for (var k in params) {
          if (Object.prototype.hasOwnProperty.call(params, k) && params[k] != null) {
            qs += '&' + encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
          }
        }
      }

      script.src = GAS_URL + '?' + qs;
      document.body.appendChild(script);

      // Timeout 25 detik (GAS kadang lambat saat cold start)
      timeoutId = setTimeout(function () {
        cleanup();
        reject(new Error('TIMEOUT'));
      }, 25000);
    });
  }

  // ==========================================
  // SESSION (localStorage guru)
  // ==========================================
  function saveSession(data) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) { /* storage penuh / private mode */ }
  }

  function getSession() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function clearSession() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
  }

  // ==========================================
  // API PUBLIK
  // ==========================================
  var API = {

    // ---------- GURU ----------

    /**
     * Login guru.
     * @returns {Promise<{ok:boolean, guru?:{id,email,nama,sekolah}, message?:string}>}
     */
    teacherLogin: function (email, password) {
      return _request('teacherLogin', { email: email, password: password })
        .then(function (res) {
          if (res && res.ok && res.guru) {
            saveSession(res.guru);
          }
          return res;
        });
    },

    /**
     * Aktivasi akun guru dengan kode aktivasi (setelah pembelian).
     * @returns {Promise<{ok:boolean, guru?:{id,email,nama}, message?:string}>}
     */
    activateTeacher: function (email, nama, sekolah, kodeAktivasi, password) {
      return _request('activateTeacher', {
        email: email,
        nama: nama,
        sekolah: sekolah,
        kode_aktivasi: kodeAktivasi,
        password: password
      }).then(function (res) {
        if (res && res.ok && res.guru) {
          saveSession(res.guru);
        }
        return res;
      });
    },

    /**
     * Ambil data guru saat ini dari localStorage (sync, tidak ke server).
     */
    currentTeacher: function () {
      return getSession();
    },

    logout: function () {
      clearSession();
    },

    /**
     * Buat kelas baru.
     * @param {object} payload { teacher_id, nama_kelas, paket_id, durasi_menit, pin, acak, tampil_pembahasan }
     */
    createClass: function (payload) {
      return _request('createClass', payload);
    },

    /**
     * Daftar kelas milik guru.
     * @param {string} teacherId
     */
    getMyClasses: function (teacherId) {
      return _request('getMyClasses', { teacher_id: teacherId });
    },

    /**
     * Detail satu kelas (info + daftar murid + status).
     * @param {string} classId
     */
    getClassDetail: function (classId) {
      return _request('getClassDetail', { class_id: classId });
    },

    /**
     * Hasil & analitik satu kelas (untuk tab Laporan).
     * @param {string} classId
     */
    getClassAnalytics: function (classId) {
      return _request('getClassAnalytics', { class_id: classId });
    },

    /**
     * Tutup/buka kelas (stop submit).
     * @param {string} classId
     * @param {boolean} tutup  true = tutup
     */
    setClassClosed: function (classId, tutup) {
      return _request('setClassClosed', { class_id: classId, tutup: tutup ? '1' : '0' });
    },

    // ---------- MURID ----------

    /**
     * Murid join kelas dengan kode + nama.
     * @returns {Promise<{ok:boolean, student?:{id,nama}, class?:{id,nama_kelas,paket_id}, message?:string}>}
     */
    joinClass: function (kodeKelas, nama, absen, pin) {
      return _request('joinClass', {
        kode_kelas: kodeKelas,
        nama: nama,
        absen: absen || '',
        pin: pin || ''
      });
    },

    /**
     * Ambil soal untuk kelas (dari paket XML terkait).
     * @param {string} classId
     * @param {string} studentId
     */
    getQuestions: function (classId, studentId) {
      return _request('getQuestions', {
        class_id: classId,
        student_id: studentId
      });
    },

     /**
     * Submit jawaban murid.
     * @param {object} payload { class_id, student_id, jawaban (JSON string), durasi_detik }
     * @returns {Promise<{ok:boolean, skor?:number, pembahasan?:Array, message?:string}>}
     *   pembahasan hanya ada jika kelas.tampil_pembahasan = 1:
     *   [{ soal_id, pertanyaan, jawaban_user, kunci, benar, skor }]
     */
    submitResult: function (payload) {
      return _request('submitResult', payload);
    },

    // ---------- PAKET (guru) ----------

    /**
     * Daftar paket soal aktif untuk dropdown di guru.html.
     * @param {string} teacherId (opsional) — untuk validasi
     */
    getPackagesForTeacher: function (teacherId) {
      return _request('getPackagesForTeacher', { teacher_id: teacherId || '' });
    },

    // ---------- ADMIN (super admin) ----------

    adminGenerateActivation: function (token, jumlah) {
      return _request('adminGenerateActivation', { token: token, jumlah: jumlah || 1 });
    },

    adminListTeachers: function (token) {
      return _request('adminListTeachers', { token: token });
    },

    adminListPackages: function (token) {
      return _request('adminListPackages', { token: token });
    },

    /**
     * Tambah paket baru.
     * @param {object} payload { token, nama_paket, file_xml, harga }
     */
    adminCreatePackage: function (payload) {
      return _request('adminCreatePackage', payload);
    },

    /**
     * Aktifkan / nonaktifkan paket.
     * @param {string} token
     * @param {string} id
     * @param {boolean} aktif
     */
    adminTogglePackage: function (token, id, aktif) {
      return _request('adminTogglePackage', {
        token: token,
        id: id,
        aktif: aktif ? '1' : '0'
      });
    },

    /**
     * Hapus paket (ditolak jika masih dipakai kelas).
     */
    adminDeletePackage: function (token, id) {
      return _request('adminDeletePackage', { token: token, id: id });
    },

    /**
     * Statistik aktivasi & guru.
     */
    getActivationStats: function (token) {
      return _request('getActivationStats', { token: token });
    },

    // ---------- UTIL ----------

    /**
     * Cek apakah error adalah error teknis (jaringan/timeout).
     * Dipakai halaman untuk membedakan pesan UI.
     */
    isNetworkError: function (err) {
      return err && (err.message === 'NETWORK_ERROR' || err.message === 'TIMEOUT');
    },

    /**
     * Pesan ramah untuk error teknis.
     */
    friendlyError: function (err) {
      if (!err) return 'Terjadi kesalahan.';
      if (err.message === 'TIMEOUT') return 'Server terlalu lama merespons. Periksa koneksi Anda.';
      if (err.message === 'NETWORK_ERROR') return 'Gagal menghubungi server. Periksa koneksi internet.';
      return err.message || 'Terjadi kesalahan.';
    }
  };

  // Ekspos ke global
  global.API = API;

})(window);
