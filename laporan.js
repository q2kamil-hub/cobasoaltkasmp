/**
 * laporan.js — Modul Laporan Diagnostik SiapTKA (Fase 2)
 * ======================================================
 * Bertanggung jawab untuk:
 *   1. Render grafik (Chart.js) di tab Laporan guru.html
 *   2. Ekspor data ke Excel (.xlsx) via SheetJS
 *   3. Ekspor laporan ke PDF via jsPDF
 *
 * Dipanggil dari guru.html: Laporan.render(res, classInfo)
 * di mana res = response dari API.getClassAnalytics()
 *
 * Bergantung pada library global (dimuat via CDN di guru.html):
 *   - Chart  (Chart.js)
 *   - XLSX   (SheetJS)
 *   - jspdf  (jsPDF UMD)
 */

(function (global) {
  'use strict';

  // Simpan instance Chart agar bisa di-destroy saat render ulang
  var _chartMurid = null;
  var _chartSoal = null;

  // Simpan data terakhir (untuk ekspor)
  var _last = null;

  // ==========================================
  // RENDER UTAMA
  // ==========================================
  /**
   * @param {object} res        - response getClassAnalytics: {summary, per_student, per_question}
   * @param {object} classInfo  - {nama_kelas, kode_kelas, ...}
   */
  function render(res, classInfo) {
    _last = { res: res, classInfo: classInfo || {} };
    var wrap = document.getElementById('laporan-wrap');
    if (!wrap) return;

    if (!res || !res.summary) {
      wrap.innerHTML = '<p>Data laporan tidak tersedia.</p>';
      return;
    }

    var s = res.summary;
    var html = '';

    // ---- Stat cards ----
    html += '<div class="stat-row">';
    html += card(s.jumlah_selesai + '/' + s.jumlah_murid, 'Selesai');
    html += card(s.rata_rata, 'Rata-rata');
    html += card(s.tertinggi, 'Tertinggi');
    html += card(s.total_soal, 'Jumlah Soal');
    html += '</div>';

    // ---- Tombol ekspor ----
    html += '<div style="display:flex; gap:10px; margin:8px 0 20px; flex-wrap:wrap">';
    html += '<button class="btn btn-outline btn-sm" onclick="Laporan.exportExcel()">📥 Ekspor Excel</button>';
    html += '<button class="btn btn-outline btn-sm" onclick="Laporan.exportPDF()">📄 Ekspor PDF</button>';
    html += '</div>';

    // ---- Grafik skor per murid ----
    html += '<h4 style="margin:20px 0 12px; font-size:15px">Skor per Murid</h4>';
    html += '<div style="background:white; border:1px solid var(--border); border-radius:12px; padding:16px; margin-bottom:24px">';
    html += '<canvas id="chart-murid" height="220"></canvas>';
    html += '</div>';

    // ---- Grafik butir soal ----
    html += '<h4 style="margin:20px 0 12px; font-size:15px">Analisis Butir Soal (Paling Sering Salah di Atas)</h4>';
    html += '<div style="background:white; border:1px solid var(--border); border-radius:12px; padding:16px; margin-bottom:16px">';
    html += '<canvas id="chart-soal" height="260"></canvas>';
    html += '</div>';

    // ---- Tabel detail (fallback jika grafik tak tampil) ----
    html += '<h4 style="margin:20px 0 12px; font-size:15px">Rekap Nilai</h4>';
    html += renderRekapTable(res.per_student);

    wrap.innerHTML = html;

    // Render grafik setelah DOM siap
    setTimeout(function () {
      renderChartMurid(res.per_student);
      renderChartSoal(res.per_question);
    }, 0);
  }

  function card(num, label) {
    return '<div class="stat"><div class="num">' + num + '</div><div class="lbl">' + label + '</div></div>';
  }

  function renderRekapTable(perStudent) {
    if (!perStudent || !perStudent.length) return '<p style="color:var(--muted)">Belum ada data.</p>';
    var sorted = perStudent.slice().sort(function (a, b) { return b.skor - a.skor; });
    var html = '<table><thead><tr><th>No</th><th>Nama</th><th>Absen</th><th>Skor</th><th>Durasi</th></tr></thead><tbody>';
    sorted.forEach(function (s, i) {
      var durasi = s.durasi_detik ? Math.floor(s.durasi_detik / 60) + 'm ' + (s.durasi_detik % 60) + 's' : '—';
      html += '<tr><td>' + (i + 1) + '</td><td>' + esc(s.nama) + '</td><td>' + esc(s.absen || '—') + '</td><td><strong>' + s.skor + '</strong></td><td>' + durasi + '</td></tr>';
    });
    html += '</tbody></table>';
    return html;
  }

  // ==========================================
  // GRAFIK
  // ==========================================
  function renderChartMurid(perStudent) {
    var canvas = document.getElementById('chart-murid');
    if (!canvas || typeof Chart === 'undefined') return;
    if (_chartMurid) { _chartMurid.destroy(); _chartMurid = null; }

    var sorted = (perStudent || []).slice().sort(function (a, b) { return b.skor - a.skor; });
    var labels = sorted.map(function (s) { return s.nama; });
    var data = sorted.map(function (s) { return s.skor; });

    _chartMurid = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: 'Skor',
          data: data,
          backgroundColor: '#2563eb',
          borderRadius: 6,
          maxBarThickness: 40
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: function (ctx) { return 'Skor: ' + ctx.parsed.y; } } }
        },
        scales: {
          y: { beginAtZero: true, ticks: { precision: 0 } },
          x: { ticks: { autoSkip: false, maxRotation: 45, minRotation: 0, font: { size: 11 } } }
        }
      }
    });
  }

  function renderChartSoal(perQuestion) {
    var canvas = document.getElementById('chart-soal');
    if (!canvas || typeof Chart === 'undefined') return;
    if (_chartSoal) { _chartSoal.destroy(); _chartSoal = null; }

    // Urutkan dari yang paling sering salah
    var sorted = (perQuestion || []).slice().sort(function (a, b) {
      var ra = a.total ? a.salah / a.total : 0;
      var rb = b.total ? b.salah / b.total : 0;
      return rb - ra;
    });

    var labels = sorted.map(function (q) { return 'Soal #' + q.soal_id; });
    var dataBenar = sorted.map(function (q) { return q.total ? Math.round((q.benar / q.total) * 100) : 0; });
    var dataSalah = sorted.map(function (q) { return q.total ? Math.round((q.salah / q.total) * 100) : 0; });

    _chartSoal = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          { label: '% Benar', data: dataBenar, backgroundColor: '#10b981', borderRadius: 4, stack: 's' },
          { label: '% Salah', data: dataSalah, backgroundColor: '#ef4444', borderRadius: 4, stack: 's' }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom' },
          tooltip: {
            callbacks: {
              label: function (ctx) { return ctx.dataset.label + ': ' + ctx.parsed.y + '%'; }
            }
          }
        },
        scales: {
          x: { stacked: true, ticks: { autoSkip: false, maxRotation: 45, font: { size: 11 } } },
          y: { stacked: true, beginAtZero: true, max: 100, ticks: { callback: function (v) { return v + '%'; } } }
        }
      }
    });
  }

  // ==========================================
  // EKSPOR EXCEL
  // ==========================================
  function exportExcel() {
    if (!_last || !_last.res) { toast('Belum ada data untuk diekspor.', 'error'); return; }
    if (typeof XLSX === 'undefined') { toast('Library Excel belum termuat.', 'error'); return; }

    var res = _last.res;
    var cls = _last.classInfo || {};
    var wb = XLSX.utils.book_new();

    // Sheet 1: Ringkasan
    var summaryAoa = [
      ['LAPORAN KELAS'],
      ['Kelas', cls.nama_kelas || '-'],
      ['Kode Kelas', cls.kode_kelas || '-'],
      ['Tanggal Ekspor', new Date().toLocaleString('id-ID')],
      [],
      ['Jumlah Murid', res.summary.jumlah_murid],
      ['Selesai', res.summary.jumlah_selesai],
      ['Rata-rata', res.summary.rata_rata],
      ['Tertinggi', res.summary.tertinggi],
      ['Jumlah Soal', res.summary.total_soal]
    ];
    var wsSummary = XLSX.utils.aoa_to_sheet(summaryAoa);
    wsSummary['!cols'] = [{ wch: 20 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Ringkasan');

    // Sheet 2: Rekap per murid
    var sorted = (res.per_student || []).slice().sort(function (a, b) { return b.skor - a.skor; });
    var rekapAoa = [['No', 'Nama', 'Absen', 'Skor', 'Durasi (detik)']];
    sorted.forEach(function (s, i) {
      rekapAoa.push([i + 1, s.nama, s.absen || '', s.skor, s.durasi_detik || 0]);
    });
    var wsRekap = XLSX.utils.aoa_to_sheet(rekapAoa);
    wsRekap['!cols'] = [{ wch: 5 }, { wch: 25 }, { wch: 8 }, { wch: 8 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, wsRekap, 'Rekap Nilai');

    // Sheet 3: Analisis butir soal
    var soalSorted = (res.per_question || []).slice().sort(function (a, b) {
      var ra = a.total ? a.salah / a.total : 0;
      var rb = b.total ? b.salah / b.total : 0;
      return rb - ra;
    });
    var soalAoa = [['Soal ID', 'Pertanyaan', 'Benar', 'Salah', 'Total Jawaban', '% Benar']];
    soalSorted.forEach(function (q) {
      var pct = q.total ? Math.round((q.benar / q.total) * 100) : 0;
      soalAoa.push([q.soal_id, q.pertanyaan || '', q.benar, q.salah, q.total, pct + '%']);
    });
    var wsSoal = XLSX.utils.aoa_to_sheet(soalAoa);
    wsSoal['!cols'] = [{ wch: 10 }, { wch: 60 }, { wch: 8 }, { wch: 8 }, { wch: 14 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, wsSoal, 'Per Soal');

    var filename = 'Laporan_' + slug(cls.nama_kelas || 'Kelas') + '_' + dateStamp() + '.xlsx';
    XLSX.writeFile(wb, filename);
    toast('Excel berhasil diunduh.', 'success');
  }

  // ==========================================
  // EKSPOR PDF
  // ==========================================
  function exportPDF() {
    if (!_last || !_last.res) { toast('Belum ada data untuk diekspor.', 'error'); return; }
    var jsPDFCtor = (global.jspdf && global.jspdf.jsPDF) || global.jsPDF;
    if (!jsPDFCtor) { toast('Library PDF belum termuat.', 'error'); return; }

    var res = _last.res;
    var cls = _last.classInfo || {};
    var doc = new jsPDFCtor({ unit: 'mm', format: 'a4' });
    var pageW = doc.internal.pageSize.getWidth();
    var margin = 15;
    var y = 20;

    // Header
    doc.setFillColor(30, 58, 138); // #1e3a8a
    doc.rect(0, 0, pageW, 30, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(16);
    doc.setFont(undefined, 'bold');
    doc.text('LAPORAN LATIHAN TKA', margin, 13);
    doc.setFontSize(10);
    doc.setFont(undefined, 'normal');
    doc.text('SiapTKA — ' + (cls.nama_kelas || 'Kelas'), margin, 21);
    doc.text(new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' }), pageW - margin, 21, { align: 'right' });

    y = 42;
    doc.setTextColor(31, 41, 55);
    doc.setFontSize(11);
    doc.setFont(undefined, 'bold');
    doc.text('Ringkasan', margin, y); y += 7;

    doc.setFont(undefined, 'normal');
    doc.setFontSize(10);
    var s = res.summary;
    var lines = [
      ['Kode Kelas', cls.kode_kelas || '-'],
      ['Jumlah Murid', s.jumlah_murid],
      ['Selesai', s.jumlah_selesai],
      ['Rata-rata', s.rata_rata],
      ['Tertinggi', s.tertinggi],
      ['Jumlah Soal', s.total_soal]
    ];
    lines.forEach(function (row) {
      doc.text(String(row[0]), margin, y);
      doc.text(': ' + String(row[1]), margin + 40, y);
      y += 6;
    });

    // Tabel Rekap
    y += 6;
    doc.setFont(undefined, 'bold');
    doc.setFontSize(11);
    doc.text('Rekap Nilai', margin, y); y += 7;
    doc.setFont(undefined, 'normal');
    doc.setFontSize(9);

    var cols = [
      { label: 'No', x: margin, w: 10 },
      { label: 'Nama', x: margin + 10, w: 80 },
      { label: 'Absen', x: margin + 90, w: 15 },
      { label: 'Skor', x: margin + 105, w: 20 },
      { label: 'Durasi', x: margin + 125, w: 30 }
    ];

    // Header tabel
    doc.setFillColor(241, 245, 249);
    doc.rect(margin, y - 5, pageW - margin * 2, 7, 'F');
    doc.setFont(undefined, 'bold');
    cols.forEach(function (c) { doc.text(c.label, c.x, y); });
    y += 6;
    doc.setFont(undefined, 'normal');

    var sorted = (res.per_student || []).slice().sort(function (a, b) { return b.skor - a.skor; });
    sorted.forEach(function (s, i) {
      if (y > 275) { doc.addPage(); y = 20; }
      var durasi = s.durasi_detik ? Math.floor(s.durasi_detik / 60) + 'm ' + (s.durasi_detik % 60) + 's' : '-';
      doc.text(String(i + 1), cols[0].x, y);
      doc.text(truncate(s.nama, 45), cols[1].x, y);
      doc.text(String(s.absen || '-'), cols[2].x, y);
      doc.text(String(s.skor), cols[3].x, y);
      doc.text(durasi, cols[4].x, y);
      y += 5.5;
    });

    // Halaman 2: Analisis butir soal
    doc.addPage();
    y = 20;
    doc.setFont(undefined, 'bold');
    doc.setFontSize(11);
    doc.text('Analisis Butir Soal', margin, y); y += 3;
    doc.setFontSize(9);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(107, 114, 128);
    doc.text('Diurutkan dari soal yang paling sering dijawab salah.', margin, y + 4);
    y += 12;
    doc.setTextColor(31, 41, 55);

    var soalSorted = (res.per_question || []).slice().sort(function (a, b) {
      var ra = a.total ? a.salah / a.total : 0;
      var rb = b.total ? b.salah / b.total : 0;
      return rb - ra;
    });

    soalSorted.forEach(function (q) {
      if (y > 275) { doc.addPage(); y = 20; }
      var pct = q.total ? Math.round((q.benar / q.total) * 100) : 0;
      doc.setFont(undefined, 'bold');
      doc.text('Soal #' + q.soal_id, margin, y);
      doc.setFont(undefined, 'normal');
      doc.text('Benar: ' + q.benar + '  |  Salah: ' + q.salah + '  |  ' + pct + '% benar', margin + 30, y);
      y += 5;
      // Pertanyaan (wrap)
      var linesQ = doc.splitTextToSize(truncate(q.pertanyaan || '', 200), pageW - margin * 2 - 5);
      doc.setTextColor(107, 114, 128);
      doc.text(linesQ, margin + 5, y);
      y += linesQ.length * 4.5 + 3;
      doc.setTextColor(31, 41, 55);
    });

    // Footer semua halaman
    var total = doc.internal.getNumberOfPages();
    for (var p = 1; p <= total; p++) {
      doc.setPage(p);
      doc.setFontSize(8);
      doc.setTextColor(150, 150, 150);
      doc.text('Dicetak dari SiapTKA · Halaman ' + p + ' dari ' + total,
        pageW / 2, 290, { align: 'center' });
    }

    var filename = 'Laporan_' + slug(cls.nama_kelas || 'Kelas') + '_' + dateStamp() + '.pdf';
    doc.save(filename);
    toast('PDF berhasil diunduh.', 'success');
  }

  // ==========================================
  // UTIL
  // ==========================================
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function truncate(s, n) {
    s = String(s || '');
    return s.length > n ? s.substring(0, n - 1) + '…' : s;
  }
  function slug(s) {
    return String(s || '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '') || 'Kelas';
  }
  function dateStamp() {
    var d = new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate());
  }
  function toast(msg, type) {
    if (typeof global.toast === 'function') {
      global.toast(msg, type);
    } else {
      alert(msg);
    }
  }

  // ==========================================
  // EKSPOR
  // ==========================================
  global.Laporan = {
    render: render,
    exportExcel: exportExcel,
    exportPDF: exportPDF
  };

})(window);
