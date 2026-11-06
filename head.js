/**
 * head.js — Favicon & meta terpusat untuk SiapTKA
 * ================================================
 * Satu-satunya tempat untuk mendefinisikan favicon, apple-touch-icon,
 * dan meta tag head yang berlaku global. Semua halaman cukup memuat:
 *
 *   <script src="head.js"></script>
 *
 * di dalam <head>, dan TIDAK perlu lagi menulis <link rel="icon"> manual.
 *
 * Catatan:
 *  - Script ini harus dimuat di <head> (bukan di akhir body) agar
 *    favicon langsung terpasang sebelum render.
 *  - Aman dijalankan berkali-kali (idempoten) — jika tag sudah ada,
 *    tidak akan diduplikasi.
 *  - Tidak bergantung pada API/framework apa pun.
 */

(function () {
  'use strict';

  // ==========================================
  // KONFIGURASI FAVICON & IKON
  // ==========================================
  var ICONS = [
    { rel: 'icon',             type: 'image/png', sizes: '32x32', href: 'favicon-32.png' },
    { rel: 'icon',             type: 'image/png', sizes: '16x16', href: 'favicon-16.png' },
    { rel: 'apple-touch-icon',                     sizes: '192x192', href: 'icon-192.png' }
  ];

  // Meta tambahan yang ingin dipusatkan (opsional).
  // Halaman boleh menimpa dengan menulis tag sendiri SETELAH head.js dimuat,
  // atau menghapus entri di sini jika tidak diperlukan.
  var META = [
    { name: 'theme-color', content: '#1e3a8a' },
    { name: 'mobile-web-app-capable', content: 'yes' },
    { name: 'apple-mobile-web-app-capable', content: 'yes' },
    { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' },
    { name: 'apple-mobile-web-app-title', content: 'SiapTKA' }
  ];

  // ==========================================
  // UTIL: cek apakah tag sudah ada
  // ==========================================
  function iconExists(href, rel) {
    var links = document.head.querySelectorAll('link[rel="' + rel + '"]');
    for (var i = 0; i < links.length; i++) {
      if (links[i].getAttribute('href') === href) return true;
    }
    return false;
  }

  function metaExists(name) {
    return !!document.head.querySelector('meta[name="' + name + '"]');
  }

  // ==========================================
  // SUNTIKKAN TAG
  // ==========================================
  function injectIcons() {
    ICONS.forEach(function (cfg) {
      if (iconExists(cfg.href, cfg.rel)) return;
      var link = document.createElement('link');
      link.rel = cfg.rel;
      if (cfg.type)  link.type = cfg.type;
      if (cfg.sizes) link.sizes = cfg.sizes;
      link.href = cfg.href;
      document.head.appendChild(link);
    });
  }

  function injectMeta() {
    META.forEach(function (cfg) {
      if (metaExists(cfg.name)) return;
      var meta = document.createElement('meta');
      meta.name = cfg.name;
      meta.content = cfg.content;
      document.head.appendChild(meta);
    });
  }

  // ==========================================
  // JALANKAN
  // ==========================================
  // document.head sudah tersedia saat <script> di <head> dieksekusi,
  // tetapi kita tetap jaga-jaga.
  if (document.head) {
    injectIcons();
    injectMeta();
  } else {
    document.addEventListener('DOMContentLoaded', function () {
      injectIcons();
      injectMeta();
    });
  }
})();
