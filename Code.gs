/**
 * Code.gs — Backend SiapTKA (Fase 1: Guru–Murid)
 * ================================================
 * Deploy sebagai Web App: Execute as "Me", Who has access "Anyone".
 *
 * Arsitektur:
 *  - Frontend memanggil via JSONP (GET + callback) — lihat api.js
 *  - Semua response dibungkus: callback({ok, ...})
 *  - ID entitas = UUID (bukan row number) untuk kemudahan migrasi
 *
 * Sheet dibuat otomatis oleh initSheet() saat pertama diakses:
 *  Teachers, Activations, Classes, Students, Results, Packages
 *
 * Kunci jawaban TIDAK PERNAH dikirim ke browser murid.
 * Pencocokan dilakukan di server (submitResult).
 */

// ==================== KONFIGURASI ====================
var SPREADSHEET_ID = '1G9qOfRcP0akLDJMPG5e-upT8uH0jcTiNRQrG8fA550I';
var ADMIN_TOKEN   = 'TKA_Super_Rahasia_2026!';
// Durasi default masa aktif guru saat aktivasi (hari)
var GURU_MASA_AKTIF_HARI = 365;

// Nama tab
var SH = {
  TEACHERS:    'Teachers',
  ACTIVATIONS: 'Activations',
  CLASSES:     'Classes',
  STUDENTS:    'Students',
  RESULTS:     'Results',
  PACKAGES:    'Packages'
};

// Header tiap tab (urut kolom)
var HEADERS = {
  Teachers:    ['id','email','password_hash','salt','nama','sekolah','aktif_sampai','created_at'],
  Activations: ['kode','dipakai_oleh','tanggal_pakai','status'],
  Classes:     ['id','teacher_id','nama_kelas','paket_id','kode_kelas','pin','durasi_menit','buka','tutup','acak','tampil_pembahasan','status','created_at'],
  Students:    ['id','class_id','nama','absen','waktu_masuk'],
  Results:     ['id','student_id','class_id','skor','jawaban_json','waktu_selesai','durasi_detik'],
  Packages:    ['id','nama_paket','file_xml','harga','aktif']
};

// ==================== UTIL ====================

function generateUUID() {
  return Utilities.getUuid();
}

function nowIso() {
  return new Date().toISOString();
}

function hashPassword(password, salt) {
  var raw = salt + password;
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw);
  return digest.map(function (b) {
    return ('0' + (b & 0xFF).toString(16)).slice(-2);
  }).join('');
}

function generateSalt() {
  var bytes = Utilities.getUuid() + Utilities.getUuid();
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes)
    .map(function (b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); })
    .join('').substring(0, 32);
}

function generateKodeKelas(length) {
  length = length || 6;
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // tanpa 0/O/1/I
  var s = '';
  for (var i = 0; i < length; i++) {
    s += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return s;
}

function generateKodeAktivasi() {
  var seg = function () {
    var c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    var s = '';
    for (var i = 0; i < 4; i++) s += c.charAt(Math.floor(Math.random() * c.length));
    return s;
  };
  return 'GURU-' + seg() + '-' + seg();
}

// ==================== SPREADSHEET ====================

function getSpreadsheet() {
  if (!SPREADSHEET_ID || SPREADSHEET_ID.indexOf('TEMPEL') === 0) {
    throw new Error('SPREADSHEET_ID belum diisi di Code.gs.');
  }
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  initSheet(ss);
  return ss;
}

/**
 * Idempoten: buat semua tab + header jika belum ada.
 * Aman dipanggil tiap request.
 */
function initSheet(ss) {
  Object.keys(HEADERS).forEach(function (name) {
    var sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
    }
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(HEADERS[name]);
      sheet.setFrozenRows(1);
    }
  });
}

function getSheet(name) {
  return getSpreadsheet().getSheetByName(name);
}

/**
 * Baca semua data sheet sebagai array of object (key = header).
 */
function readAll(sheet) {
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  var headers = values[0];
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var obj = {};
    for (var j = 0; j < headers.length; j++) {
      obj[headers[j]] = values[i][j];
    }
    rows.push(obj);
  }
  return rows;
}

/**
 * Cari baris (1-based) berdasarkan nilai kolom tertentu.
 */
function findRowIndex(sheet, colName, value) {
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return -1;
  var headers = values[0];
  var colIdx = headers.indexOf(colName);
  if (colIdx < 0) return -1;
  var target = String(value).trim();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][colIdx]).trim() === target) return i + 1;
  }
  return -1;
}

// ==================== ROUTER ====================

function doGet(e) {
  var p = e.parameter || {};
  var callback = p.callback;
  var action = p.action;

  var result;
  try {
    switch (action) {
      // ---- GURU ----
      case 'teacherLogin':         result = handleTeacherLogin(p); break;
      case 'activateTeacher':      result = handleActivateTeacher(p); break;
      case 'createClass':          result = handleCreateClass(p); break;
      case 'getMyClasses':         result = handleGetMyClasses(p); break;
      case 'getClassDetail':       result = handleGetClassDetail(p); break;
      case 'getClassAnalytics':    result = handleGetClassAnalytics(p); break;
      case 'setClassClosed':       result = handleSetClassClosed(p); break;

      // ---- MURID ----
      case 'joinClass':            result = handleJoinClass(p); break;
      case 'getQuestions':         result = handleGetQuestions(p); break;
      case 'submitResult':         result = handleSubmitResult(p); break;

      // ---- ADMIN ----
      case 'adminGenerateActivation': result = handleAdminGenerateActivation(p); break;
      case 'adminListTeachers':       result = handleAdminListTeachers(p); break;

      // ---- PAKET (guru) ----
      case 'getPackagesForTeacher': result = handleGetPackagesForTeacher(p); break;

      // ---- ADMIN: PAKET ----
      case 'adminListPackages':     result = handleAdminListPackages(p); break;
      case 'adminCreatePackage':    result = handleAdminCreatePackage(p); break;
      case 'adminTogglePackage':    result = handleAdminTogglePackage(p); break;
      case 'adminDeletePackage':    result = handleAdminDeletePackage(p); break;
      case 'getActivationStats':    result = handleGetActivationStats(p); break;
      case 'adminResetTeacherActive':   result = handleAdminResetTeacherActive(p); break;
      case 'adminListUnusedActivations': result = handleAdminListUnusedActivations(p); break;

      default:
        result = { ok: false, message: 'Action tidak dikenal: ' + action };
    }
  } catch (err) {
    result = { ok: false, message: 'Server error: ' + err.message };
  }

  // Jika ada callback → JSONP, jika tidak → JSON biasa
  if (callback) {
    return ContentService
      .createTextOutput(callback + '(' + JSON.stringify(result) + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  // Disiapkan untuk masa depan; saat ini frontend memakai GET (JSONP).
  return doGet(e);
}

// ==================== HANDLER: GURU ====================

function handleTeacherLogin(p) {
  Utilities.sleep(800); // anti brute-force ringan
  var email = String(p.email || '').trim().toLowerCase();
  var pass  = String(p.password || '');
  if (!email || !pass) return { ok: false, message: 'Email dan password wajib diisi.' };

  var sheet = getSheet(SH.TEACHERS);
  var rowIdx = findRowIndex(sheet, 'email', email);
  if (rowIdx < 0) return { ok: false, message: 'Email tidak terdaftar.' };

  var row = sheet.getRange(rowIdx, 1, 1, sheet.getLastColumn()).getValues()[0];
  var headers = HEADERS.Teachers;
  var data = {};
  headers.forEach(function (h, i) { data[h] = row[i]; });

  // Cek masa aktif
  if (data.aktif_sampai) {
    var sampai = new Date(data.aktif_sampai);
    if (sampai.getTime() < Date.now()) {
      return { ok: false, message: 'Masa aktif akun sudah berakhir.' };
    }
  }

  var inputHash = hashPassword(pass, data.salt);
  if (inputHash !== data.password_hash) {
    return { ok: false, message: 'Password salah.' };
  }

  return {
    ok: true,
    guru: {
      id: data.id,
      email: data.email,
      nama: data.nama,
      sekolah: data.sekolah || '',
      aktif_sampai: data.aktif_sampai || ''
    }
  };
}

function handleActivateTeacher(p) {
  var email = String(p.email || '').trim().toLowerCase();
  var nama  = String(p.nama || '').trim();
  var sekolah = String(p.sekolah || '').trim();
  var kode  = String(p.kode_aktivasi || '').trim().toUpperCase();
  var pass  = String(p.password || '');

  if (!email || !nama || !kode || !pass) {
    return { ok: false, message: 'Email, nama, kode aktivasi, dan password wajib diisi.' };
  }
  if (pass.length < 6) {
    return { ok: false, message: 'Password minimal 6 karakter.' };
  }

  var actSheet = getSheet(SH.ACTIVATIONS);
  var actRow = findRowIndex(actSheet, 'kode', kode);
  if (actRow < 0) return { ok: false, message: 'Kode aktivasi tidak valid.' };

  var actValues = actSheet.getRange(actRow, 1, 1, actSheet.getLastColumn()).getValues()[0];
  var actStatus = String(actValues[3] || '').toLowerCase();
  if (actStatus === 'used') {
    return { ok: false, message: 'Kode aktivasi sudah pernah dipakai.' };
  }

  var tSheet = getSheet(SH.TEACHERS);
  if (findRowIndex(tSheet, 'email', email) > 0) {
    return { ok: false, message: 'Email sudah terdaftar. Silakan login.' };
  }

  var id   = generateUUID();
  var salt = generateSalt();
  var hash = hashPassword(pass, salt);
  var aktifSampai = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(); // 1 tahun

  tSheet.appendRow([id, email, hash, salt, nama, sekolah, aktifSampai, nowIso()]);

  // Tandai kode aktivasi terpakai
  actSheet.getRange(actRow, 2).setValue(email);
  actSheet.getRange(actRow, 3).setValue(nowIso());
  actSheet.getRange(actRow, 4).setValue('used');

  return {
    ok: true,
    guru: { id: id, email: email, nama: nama, sekolah: sekolah, aktif_sampai: aktifSampai }
  };
}

function handleCreateClass(p) {
  var teacherId = String(p.teacher_id || '').trim();
  var namaKelas = String(p.nama_kelas || '').trim();
  var paketId   = String(p.paket_id || '').trim();
  var durasi    = parseInt(p.durasi_menit, 10) || 60;
  var pin       = String(p.pin || '').trim();
  var acak      = String(p.acak) === '1' || p.acak === true;
  var tampilPembahasan = String(p.tampil_pembahasan) === '1' || p.tampil_pembahasan === true;

  if (!teacherId || !namaKelas || !paketId) {
    return { ok: false, message: 'Nama kelas dan paket soal wajib diisi.' };
  }

  // Pastikan guru ada
  var tSheet = getSheet(SH.TEACHERS);
  if (findRowIndex(tSheet, 'id', teacherId) < 0) {
    return { ok: false, message: 'Guru tidak ditemukan. Silakan login ulang.' };
  }

  // Pastikan paket ada & aktif
  var paketInfo = getPaketMetaById(paketId);
  if (!paketInfo) return { ok: false, message: 'Paket soal tidak ditemukan.' };
  if (String(paketInfo.aktif) !== '1') return { ok: false, message: 'Paket soal tidak aktif. Hubungi admin.' };

  var cSheet = getSheet(SH.CLASSES);

  // Generate kode kelas unik
  var kodeKelas = generateKodeKelas(6);
  var tries = 0;
  while (findRowIndex(cSheet, 'kode_kelas', kodeKelas) > 0 && tries < 20) {
    kodeKelas = generateKodeKelas(6);
    tries++;
  }

  var id = generateUUID();
  cSheet.appendRow([
    id, teacherId, namaKelas, paketId, kodeKelas, pin, durasi,
    nowIso(),           // buka
    '',                 // tutup (kosong = belum)
    acak ? '1' : '0',
    tampilPembahasan ? '1' : '0',
    'open',
    nowIso()
  ]);

  return { ok: true, class: { id: id, kode_kelas: kodeKelas, nama_kelas: namaKelas } };
}

function handleGetMyClasses(p) {
  var teacherId = String(p.teacher_id || '').trim();
  if (!teacherId) return { ok: false, message: 'teacher_id wajib.' };

  var cSheet = getSheet(SH.CLASSES);
  var all = readAll(cSheet);
  var mine = all.filter(function (c) { return String(c.teacher_id) === teacherId; });

  // Hitung jumlah murid per kelas (ringan untuk Fase 1)
  var sSheet = getSheet(SH.STUDENTS);
  var students = readAll(sSheet);
  var countMap = {};
  students.forEach(function (s) {
    countMap[s.class_id] = (countMap[s.class_id] || 0) + 1;
  });

  var classes = mine.map(function (c) {
    return {
      id: c.id,
      nama_kelas: c.nama_kelas,
      paket_id: c.paket_id,
      kode_kelas: c.kode_kelas,
      durasi_menit: parseInt(c.durasi_menit, 10) || 0,
      status: c.status,
      created_at: c.created_at,
      jumlah_murid: countMap[c.id] || 0
    };
  });

  return { ok: true, classes: classes };
}

function handleGetClassDetail(p) {
  var classId = String(p.class_id || '').trim();
  if (!classId) return { ok: false, message: 'class_id wajib.' };

  var cSheet = getSheet(SH.CLASSES);
  var cRow = findRowIndex(cSheet, 'id', classId);
  if (cRow < 0) return { ok: false, message: 'Kelas tidak ditemukan.' };

  var cVals = cSheet.getRange(cRow, 1, 1, cSheet.getLastColumn()).getValues()[0];
  var cls = {};
  HEADERS.Classes.forEach(function (h, i) { cls[h] = cVals[i]; });

  // Murid + hasil
  var sSheet = getSheet(SH.STUDENTS);
  var students = readAll(sSheet).filter(function (s) { return String(s.class_id) === classId; });

  var rSheet = getSheet(SH.RESULTS);
  var results = readAll(rSheet).filter(function (r) { return String(r.class_id) === classId; });
  var resultMap = {};
  results.forEach(function (r) { resultMap[r.student_id] = r; });

  var list = students.map(function (s) {
    var r = resultMap[s.id];
    return {
      id: s.id,
      nama: s.nama,
      absen: s.absen,
      waktu_masuk: s.waktu_masuk,
      selesai: !!r,
      skor: r ? parseFloat(r.skor) : null,
      durasi_detik: r ? parseInt(r.durasi_detik, 10) : null
    };
  });

  // Urutkan berdasarkan absen jika ada, lalu nama
  list.sort(function (a, b) {
    var na = parseInt(a.absen, 10); var nb = parseInt(b.absen, 10);
    if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
    return String(a.nama).localeCompare(String(b.nama));
  });

  return {
    ok: true,
    class: {
      id: cls.id,
      nama_kelas: cls.nama_kelas,
      paket_id: cls.paket_id,
      kode_kelas: cls.kode_kelas,
      pin: cls.pin || '',
      durasi_menit: parseInt(cls.durasi_menit, 10) || 0,
      status: cls.status,
      acak: String(cls.acak) === '1',
      tampil_pembahasan: String(cls.tampil_pembahasan) === '1',
      created_at: cls.created_at
    },
    students: list
  };
}

/**
 * Analitik dasar: ringkasan skor + per murid + per butir soal.
 * Soal diambil dari paket XML untuk menilai benar/salah per soal.
 */
function handleGetClassAnalytics(p) {
  var classId = String(p.class_id || '').trim();
  if (!classId) return { ok: false, message: 'class_id wajib.' };

  var cSheet = getSheet(SH.CLASSES);
  var cRow = findRowIndex(cSheet, 'id', classId);
  if (cRow < 0) return { ok: false, message: 'Kelas tidak ditemukan.' };

  var cVals = cSheet.getRange(cRow, 1, 1, cSheet.getLastColumn()).getValues()[0];
  var cls = {};
  HEADERS.Classes.forEach(function (h, i) { cls[h] = cVals[i]; });

  var paket = getPaketSoal(cls.paket_id);
  if (!paket) return { ok: false, message: 'Paket soal tidak ditemukan.' };

  var soalList = paket.soal; // [{id, jawaban, skor}]
  var soalById = {};
  soalList.forEach(function (s) { soalById[s.id] = s; });

  // Ambil murid & hasil
  var sSheet = getSheet(SH.STUDENTS);
  var students = readAll(sSheet).filter(function (s) { return String(s.class_id) === classId; });
  var studentMap = {};
  students.forEach(function (s) { studentMap[s.id] = s; });

  var rSheet = getSheet(SH.RESULTS);
  var results = readAll(rSheet).filter(function (r) { return String(r.class_id) === classId; });

  var perStudent = [];
  var perQuestionAgg = {}; // soal_id -> {benar, salah}
  soalList.forEach(function (q) { perQuestionAgg[q.id] = { benar: 0, salah: 0 }; });

  var totalSkor = 0, n = 0;
  var maxSkor = 0;

  results.forEach(function (r) {
    var s = studentMap[r.student_id];
    if (!s) return;
    var skor = parseFloat(r.skor) || 0;
    totalSkor += skor; n++;
    if (skor > maxSkor) maxSkor = skor;

    var jawaban = {};
    try { jawaban = JSON.parse(r.jawaban_json || '{}'); } catch (e) {}

    var detail = [];
    Object.keys(jawaban).forEach(function (soalId) {
      var q = soalById[soalId];
      if (!q) return;
      var userJawab = String(jawaban[soalId] || '').trim().toLowerCase();
      var kunci = String(q.jawaban || '').trim().toLowerCase();
      var benar = userJawab === kunci;
      if (perQuestionAgg[soalId]) {
        if (benar) perQuestionAgg[soalId].benar++;
        else perQuestionAgg[soalId].salah++;
      }
      detail.push({ soal_id: soalId, benar: benar, jawaban_user: userJawab });
    });

    perStudent.push({
      student_id: r.student_id,
      nama: s.nama,
      absen: s.absen,
      skor: skor,
      durasi_detik: parseInt(r.durasi_detik, 10) || 0,
      detail: detail
    });
  });

  var perQuestion = soalList.map(function (q) {
    var agg = perQuestionAgg[q.id] || { benar: 0, salah: 0 };
    return {
      soal_id: q.id,
      pertanyaan: q.pertanyaan,
      benar: agg.benar,
      salah: agg.salah,
      total: agg.benar + agg.salah
    };
  });

  return {
    ok: true,
    summary: {
      jumlah_selesai: n,
      jumlah_murid: students.length,
      rata_rata: n ? +(totalSkor / n).toFixed(2) : 0,
      tertinggi: maxSkor,
      total_soal: soalList.length
    },
    per_student: perStudent,
    per_question: perQuestion
  };
}

function handleSetClassClosed(p) {
  var classId = String(p.class_id || '').trim();
  var tutup = String(p.tutup) === '1';
  if (!classId) return { ok: false, message: 'class_id wajib.' };

  var cSheet = getSheet(SH.CLASSES);
  var row = findRowIndex(cSheet, 'id', classId);
  if (row < 0) return { ok: false, message: 'Kelas tidak ditemukan.' };

  var headers = HEADERS.Classes;
  var statusCol = headers.indexOf('status') + 1;
  var tutupCol  = headers.indexOf('tutup') + 1;

  cSheet.getRange(row, statusCol).setValue(tutup ? 'closed' : 'open');
  cSheet.getRange(row, tutupCol).setValue(tutup ? nowIso() : '');

  return { ok: true };
}

// ==================== HANDLER: MURID ====================

function handleJoinClass(p) {
  var kode = String(p.kode_kelas || '').trim().toUpperCase();
  var nama = String(p.nama || '').trim();
  var absen = String(p.absen || '').trim();
  var pin = String(p.pin || '').trim();

  if (!kode || !nama) {
    return { ok: false, message: 'Kode kelas dan nama wajib diisi.' };
  }

  var cSheet = getSheet(SH.CLASSES);
  var cRow = findRowIndex(cSheet, 'kode_kelas', kode);
  if (cRow < 0) return { ok: false, message: 'Kode kelas tidak ditemukan.' };

  var cVals = cSheet.getRange(cRow, 1, 1, cSheet.getLastColumn()).getValues()[0];
  var cls = {};
  HEADERS.Classes.forEach(function (h, i) { cls[h] = cVals[i]; });

  if (String(cls.status).toLowerCase() === 'closed') {
    return { ok: false, message: 'Kelas sudah ditutup oleh guru.' };
  }

  // Validasi PIN jika kelas punya PIN
  var pinKelas = String(cls.pin || '').trim();
  if (pinKelas && pin !== pinKelas) {
    return { ok: false, message: 'PIN kelas salah.' };
  }

  // Cegah nama ganda di kelas yang sama
  var sSheet = getSheet(SH.STUDENTS);
  var existing = readAll(sSheet).filter(function (s) {
    return String(s.class_id) === cls.id &&
           String(s.nama).trim().toLowerCase() === nama.toLowerCase();
  });
  if (existing.length > 0) {
    // Anggap re-join (murid refresh) → kembalikan data yang ada
    var s0 = existing[0];
    return {
      ok: true,
      student: { id: s0.id, nama: s0.nama, absen: s0.absen },
      class: { id: cls.id, nama_kelas: cls.nama_kelas, paket_id: cls.paket_id }
    };
  }

  var studentId = generateUUID();
  sSheet.appendRow([studentId, cls.id, nama, absen, nowIso()]);

  return {
    ok: true,
    student: { id: studentId, nama: nama, absen: absen },
    class: { id: cls.id, nama_kelas: cls.nama_kelas, paket_id: cls.paket_id }
  };
}

/**
 * Ambil soal untuk dikerjakan. KUNCI TIDAK DIKIRIM.
 */
function handleGetQuestions(p) {
  var classId = String(p.class_id || '').trim();
  var studentId = String(p.student_id || '').trim();
  if (!classId || !studentId) {
    return { ok: false, message: 'class_id dan student_id wajib.' };
  }

  var cSheet = getSheet(SH.CLASSES);
  var cRow = findRowIndex(cSheet, 'id', classId);
  if (cRow < 0) return { ok: false, message: 'Kelas tidak ditemukan.' };

  var cVals = cSheet.getRange(cRow, 1, 1, cSheet.getLastColumn()).getValues()[0];
  var cls = {};
  HEADERS.Classes.forEach(function (h, i) { cls[h] = cVals[i]; });

  if (String(cls.status).toLowerCase() === 'closed') {
    return { ok: false, message: 'Kelas sudah ditutup.' };
  }

  // Cek apakah murid sudah submit
  var rSheet = getSheet(SH.RESULTS);
  var existing = readAll(rSheet).filter(function (r) {
    return String(r.class_id) === classId && String(r.student_id) === studentId;
  });
  if (existing.length > 0) {
    return { ok: false, message: 'Anda sudah mengerjakan latihan ini.', already_done: true };
  }

  var paket = getPaketSoal(cls.paket_id);
  if (!paket) return { ok: false, message: 'Paket soal tidak ditemukan.' };

  var list = paket.soal.map(function (s) {
    return {
      id: s.id,
      tipe: s.tipe,
      pertanyaan: s.pertanyaan,
      pilihan: s.pilihan || [],
      skor: s.skor
      // jawaban SENGAJA tidak dikirim
    };
  });

  if (String(cls.acak) === '1') {
    // Acak urutan soal + urutan pilihan (deterministik per student agar stabil)
    list = shuffleWithSeed(list, studentId);
  }

  return {
    ok: true,
    class: {
      id: cls.id,
      nama_kelas: cls.nama_kelas,
      durasi_menit: parseInt(cls.durasi_menit, 10) || 0,
      tampil_pembahasan: String(cls.tampil_pembahasan) === '1'
    },
    questions: list
  };
}

function handleSubmitResult(p) {
  var classId = String(p.class_id || '').trim();
  var studentId = String(p.student_id || '').trim();
  var jawabanStr = String(p.jawaban || '{}');
  var durasi = parseInt(p.durasi_detik, 10) || 0;

  if (!classId || !studentId) {
    return { ok: false, message: 'class_id dan student_id wajib.' };
  }

  var cSheet = getSheet(SH.CLASSES);
  var cRow = findRowIndex(cSheet, 'id', classId);
  if (cRow < 0) return { ok: false, message: 'Kelas tidak ditemukan.' };

  var cVals = cSheet.getRange(cRow, 1, 1, cSheet.getLastColumn()).getValues()[0];
  var cls = {};
  HEADERS.Classes.forEach(function (h, i) { cls[h] = cVals[i]; });

  if (String(cls.status).toLowerCase() === 'closed') {
    return { ok: false, message: 'Kelas sudah ditutup. Jawaban tidak bisa dikirim.' };
  }

  var rSheet = getSheet(SH.RESULTS);
  var dup = readAll(rSheet).filter(function (r) {
    return String(r.class_id) === classId && String(r.student_id) === studentId;
  });
  if (dup.length > 0) {
    return { ok: false, message: 'Anda sudah mengirim jawaban sebelumnya.' };
  }

  var paket = getPaketSoal(cls.paket_id);
  if (!paket) return { ok: false, message: 'Paket soal tidak ditemukan.' };

  var jawaban;
  try { jawaban = JSON.parse(jawabanStr); }
  catch (e) { return { ok: false, message: 'Format jawaban tidak valid.' }; }

  var soalById = {};
  paket.soal.forEach(function (s) { soalById[s.id] = s; });

  var totalSkor = 0;
  var detail = [];
  Object.keys(jawaban).forEach(function (soalId) {
    var q = soalById[soalId];
    if (!q) return;
    var userJawab = String(jawaban[soalId] || '').trim();
    var kunci = String(q.jawaban || '').trim();
    var benar = userJawab.toLowerCase() === kunci.toLowerCase();
    if (benar) totalSkor += parseInt(q.skor, 10) || 0;

    if (String(cls.tampil_pembahasan) === '1') {
      detail.push({
        soal_id: soalId,
        pertanyaan: q.pertanyaan,
        jawaban_user: userJawab,
        kunci: kunci,
        benar: benar,
        skor: parseInt(q.skor, 10) || 0
      });
    }
  });

  rSheet.appendRow([
    generateUUID(), studentId, classId, totalSkor, jawabanStr, nowIso(), durasi
  ]);

  var out = { ok: true, skor: totalSkor };
  if (String(cls.tampil_pembahasan) === '1') out.pembahasan = detail;
  return out;
}

// ==================== HANDLER: ADMIN ====================

function handleAdminGenerateActivation(p) {
  if (String(p.token) !== ADMIN_TOKEN) {
    return { ok: false, message: 'Token admin salah.' };
  }
  var jumlah = Math.min(parseInt(p.jumlah, 10) || 1, 100);
  var sheet = getSheet(SH.ACTIVATIONS);
  var codes = [];
  for (var i = 0; i < jumlah; i++) {
    var kode = generateKodeAktivasi();
    var tries = 0;
    while (findRowIndex(sheet, 'kode', kode) > 0 && tries < 20) {
      kode = generateKodeAktivasi(); tries++;
    }
    sheet.appendRow([kode, '', '', 'unused']);
    codes.push(kode);
  }
  return { ok: true, codes: codes };
}

function handleAdminListTeachers(p) {
  if (String(p.token) !== ADMIN_TOKEN) {
    return { ok: false, message: 'Token admin salah.' };
  }
  var sheet = getSheet(SH.TEACHERS);
  var rows = readAll(sheet).map(function (r) {
    return {
      id: r.id, email: r.email, nama: r.nama, sekolah: r.sekolah,
      aktif_sampai: r.aktif_sampai, created_at: r.created_at
    };
  });
  return { ok: true, list: rows };
}

// ==================== PAKET SOAL (XML) ====================

/**
 * Cache in-memory per eksekusi (bukan antar-request GAS).
 */
var _paketCache = {};

/**
 * Ambil paket soal berdasarkan paket_id.
 * Paket = baris di sheet Packages: {id, nama_paket, file_xml, harga, aktif}
 * File XML diambil dari Google Drive by name (file harus public/read-only).
 * Return: {id, nama, soal:[{id,tipe,pertanyaan,pilihan,jawaban,skor}]}
 */
function getPaketSoal(paketId) {
  paketId = String(paketId || '').trim();
  if (!paketId) return null;
  if (_paketCache[paketId]) return _paketCache[paketId];

  var pSheet = getSheet(SH.PACKAGES);
  var row = findRowIndex(pSheet, 'id', paketId);
  if (row < 0) return null;

  var vals = pSheet.getRange(row, 1, 1, pSheet.getLastColumn()).getValues()[0];
  var pkg = {};
  HEADERS.Packages.forEach(function (h, i) { pkg[h] = vals[i]; });

  var xmlText = loadXmlFromDrive(pkg.file_xml);
  if (!xmlText) return null;

  var parsed = parseSoalXml(xmlText);
  var result = { id: paketId, nama: pkg.nama_paket, soal: parsed };
  _paketCache[paketId] = result;
  return result;
}

/**
 * Baca file XML dari Google Drive berdasarkan nama.
 * File harus bisa dibaca (shared "Anyone with the link" atau milik akun GAS).
 */
function loadXmlFromDrive(fileName) {
  try {
    var files = DriveApp.getFilesByName(fileName);
    if (!files.hasNext()) return null;
    var file = files.next();
    return file.getBlob().getDataAsString('UTF-8');
  } catch (e) {
    return null;
  }
}

/**
 * Parse XML soal. Format:
 * <paket>
 *   <soal id="1" tipe="pg" skor="10">
 *     <pertanyaan>...</pertanyaan>
 *     <pilihan>A. ...</pilihan>
 *     ...
 *     <jawaban>A</jawaban>
 *   </soal>
 * </paket>
 */
function parseSoalXml(xmlText) {
  var doc = XmlService.parse(xmlText);
  var root = doc.getRootElement();
  var soalEls = root.getChildren('soal');
  var list = [];
  soalEls.forEach(function (el) {
    var id = el.getAttribute('id') ? el.getAttribute('id').getValue() : '';
    var tipe = el.getAttribute('tipe') ? el.getAttribute('tipe').getValue() : 'pg';
    var skor = el.getAttribute('skor') ? parseInt(el.getAttribute('skor').getValue(), 10) : 10;
    var pertanyaan = '';
    var pilihan = [];
    var jawaban = '';

    el.getChildren().forEach(function (child) {
      var n = child.getName();
      if (n === 'pertanyaan') pertanyaan = child.getText();
      else if (n === 'pilihan') pilihan.push(child.getText().trim());
      else if (n === 'jawaban') jawaban = child.getText().trim();
    });

    list.push({
      id: id,
      tipe: tipe,
      pertanyaan: pertanyaan,
      pilihan: pilihan,
      jawaban: jawaban,
      skor: skor
    });
  });
  return list;
}

// ==================== UTIL: SHUFFLE DETERMINISTIK ====================

/**
 * Shuffle array dengan seed string (deterministik).
 * Dipakai untuk mengacak soal per murid agar konsisten jika refresh.
 */
function shuffleWithSeed(arr, seedStr) {
  var seed = 0;
  for (var i = 0; i < seedStr.length; i++) {
    seed = (seed * 31 + seedStr.charCodeAt(i)) & 0xFFFFFFFF;
  }
  function rnd() {
    seed = (seed * 1664525 + 1013904223) & 0xFFFFFFFF;
    return (seed >>> 0) / 0xFFFFFFFF;
  }
  var a = arr.slice();
  for (var j = a.length - 1; j > 0; j--) {
    var k = Math.floor(rnd() * (j + 1));
    var tmp = a[j]; a[j] = a[k]; a[k] = tmp;
  }
  return a;
}

// ==================== SETUP (jalankan sekali dari editor) ====================

/**
 * Jalankan manual sekali dari editor GAS untuk memastikan semua tab dibuat
 * dan paket soal pertama terdaftar.
 */
function setup() {
  var ss = getSpreadsheet();
  Logger.log('Spreadsheet: ' + ss.getUrl());

  // Buat paket default jika belum ada
  var pSheet = getSheet(SH.PACKAGES);
  if (readAll(pSheet).length === 0) {
    pSheet.appendRow([generateUUID(), 'Matematika Dasar', 'matematika.xml', 0, '1']);
    Logger.log('Paket "Matematika Dasar" dibuat. Ganti file_xml sesuai nama file di Drive.');
  }

  Logger.log('Selesai. Semua tab siap.');
}

// ==================== HELPER PAKET ====================

/**
 * Ambil metadata paket (tanpa soal) dari sheet Packages.
 * Return: {id, nama_paket, file_xml, harga, aktif} atau null.
 */
function getPaketMetaById(paketId) {
  paketId = String(paketId || '').trim();
  if (!paketId) return null;
  var sheet = getSheet(SH.PACKAGES);
  var row = findRowIndex(sheet, 'id', paketId);
  if (row < 0) return null;
  var vals = sheet.getRange(row, 1, 1, sheet.getLastColumn()).getValues()[0];
  var pkg = {};
  HEADERS.Packages.forEach(function (h, i) { pkg[h] = vals[i]; });
  return pkg;
}

// ==================== HANDLER: PAKET UNTUK GURU ====================

/**
 * Daftar paket aktif (untuk dropdown di guru.html).
 * Untuk Fase 3: semua paket aktif terbuka untuk semua guru.
 * (Fase berikutnya bisa filter berdasarkan pembelian per guru.)
 */
function handleGetPackagesForTeacher(p) {
  // Validasi guru (opsional — jika teacher_id dikirim, pastikan ada)
  var teacherId = String(p.teacher_id || '').trim();
  if (teacherId) {
    var tSheet = getSheet(SH.TEACHERS);
    if (findRowIndex(tSheet, 'id', teacherId) < 0) {
      return { ok: false, message: 'Guru tidak ditemukan.' };
    }
  }

  var sheet = getSheet(SH.PACKAGES);
  var all = readAll(sheet);
  var aktif = all
    .filter(function (x) { return String(x.aktif) === '1'; })
    .map(function (x) {
      return {
        id: x.id,
        nama_paket: x.nama_paket,
        file_xml: x.file_xml,
        harga: x.harga
      };
    });

  return { ok: true, packages: aktif };
}

// ==================== HANDLER: ADMIN PAKET ====================

function handleAdminListPackages(p) {
  if (String(p.token) !== ADMIN_TOKEN) return { ok: false, message: 'Token admin salah.' };

  var sheet = getSheet(SH.PACKAGES);
  var list = readAll(sheet).map(function (x) {
    // Hitung jumlah soal jika file bisa dibaca
    var jumlahSoal = null;
    try {
      var paket = getPaketSoal(x.id);
      if (paket && paket.soal) jumlahSoal = paket.soal.length;
    } catch (e) {}

    return {
      id: x.id,
      nama_paket: x.nama_paket,
      file_xml: x.file_xml,
      harga: x.harga,
      aktif: String(x.aktif) === '1',
      jumlah_soal: jumlahSoal
    };
  });

  return { ok: true, packages: list };
}

function handleAdminCreatePackage(p) {
  if (String(p.token) !== ADMIN_TOKEN) return { ok: false, message: 'Token admin salah.' };

  var nama = String(p.nama_paket || '').trim();
  var file = String(p.file_xml || '').trim();
  var harga = parseInt(p.harga, 10) || 0;

  if (!nama || !file) {
    return { ok: false, message: 'Nama paket dan nama file XML wajib diisi.' };
  }

  // Cek duplikat nama file
  var sheet = getSheet(SH.PACKAGES);
  var existing = readAll(sheet);
  for (var i = 0; i < existing.length; i++) {
    if (String(existing[i].file_xml) === file) {
      return { ok: false, message: 'File XML "' + file + '" sudah terdaftar.' };
    }
  }

  // Verifikasi file ada di Drive
  var driveOk = false;
  try {
    var files = DriveApp.getFilesByName(file);
    driveOk = files.hasNext();
  } catch (e) {}

  if (!driveOk) {
    return {
      ok: false,
      message: 'File "' + file + '" tidak ditemukan di Google Drive. Upload dulu & set sharing "Anyone with the link".'
    };
  }

  var id = generateUUID();
  sheet.appendRow([id, nama, file, harga, '1']);

  return { ok: true, id: id, nama_paket: nama, file_xml: file, harga: harga };
}

function handleAdminTogglePackage(p) {
  if (String(p.token) !== ADMIN_TOKEN) return { ok: false, message: 'Token admin salah.' };

  var id = String(p.id || '').trim();
  var aktif = String(p.aktif) === '1';

  var sheet = getSheet(SH.PACKAGES);
  var row = findRowIndex(sheet, 'id', id);
  if (row < 0) return { ok: false, message: 'Paket tidak ditemukan.' };

  var colAktif = HEADERS.Packages.indexOf('aktif') + 1;
  sheet.getRange(row, colAktif).setValue(aktif ? '1' : '0');

  return { ok: true, aktif: aktif };
}

function handleAdminDeletePackage(p) {
  if (String(p.token) !== ADMIN_TOKEN) return { ok: false, message: 'Token admin salah.' };

  var id = String(p.id || '').trim();
  var sheet = getSheet(SH.PACKAGES);
  var row = findRowIndex(sheet, 'id', id);
  if (row < 0) return { ok: false, message: 'Paket tidak ditemukan.' };

  // Cegah hapus jika paket dipakai kelas
  var cSheet = getSheet(SH.CLASSES);
  var used = readAll(cSheet).some(function (c) { return String(c.paket_id) === id; });
  if (used) {
    return {
      ok: false,
      message: 'Paket masih dipakai oleh kelas. Nonaktifkan saja, jangan hapus.'
    };
  }

  sheet.deleteRow(row);
  return { ok: true };
}

function handleGetActivationStats(p) {
  if (String(p.token) !== ADMIN_TOKEN) return { ok: false, message: 'Token admin salah.' };

  var aSheet = getSheet(SH.ACTIVATIONS);
  var acts = readAll(aSheet);
  var used = acts.filter(function (a) { return String(a.status).toLowerCase() === 'used'; }).length;
  var unused = acts.length - used;

  var tSheet = getSheet(SH.TEACHERS);
  var teachers = readAll(tSheet);

  var now = Date.now();
  var aktif = 0, expired = 0;
  teachers.forEach(function (t) {
    if (!t.aktif_sampai) { expired++; return; }
    var d = new Date(t.aktif_sampai).getTime();
    if (d > now) aktif++; else expired++;
  });

  return {
    ok: true,
    stats: {
      aktivasi_total: acts.length,
      aktivasi_terpakai: used,
      aktivasi_tersedia: unused,
      guru_total: teachers.length,
      guru_aktif: aktif,
      guru_expired: expired
    }
  };
}

function handleAdminResetTeacherActive(p) {
  if (String(p.token) !== ADMIN_TOKEN) return { ok: false, message: 'Token admin salah.' };

  var teacherId = String(p.teacher_id || '').trim();
  var tambahHari = parseInt(p.tambah_hari, 10) || GURU_MASA_AKTIF_HARI;

  if (!teacherId) return { ok: false, message: 'teacher_id wajib.' };

  var sheet = getSheet(SH.TEACHERS);
  var row = findRowIndex(sheet, 'id', teacherId);
  if (row < 0) return { ok: false, message: 'Guru tidak ditemukan.' };

  var colAktif = HEADERS.Teachers.indexOf('aktif_sampai') + 1;
  var baru = new Date(Date.now() + tambahHari * 24 * 60 * 60 * 1000).toISOString();
  sheet.getRange(row, colAktif).setValue(baru);

  return { ok: true, aktif_sampai: baru };
}

function handleAdminListUnusedActivations(p) {
  if (String(p.token) !== ADMIN_TOKEN) return { ok: false, message: 'Token admin salah.' };

  var sheet = getSheet(SH.ACTIVATIONS);
  var unused = readAll(sheet)
    .filter(function (a) { return String(a.status).toLowerCase() === 'unused'; })
    .map(function (a) { return { kode: a.kode }; });

  return { ok: true, codes: unused };
}

// ==================== SETUP PAKET AWAL (opsional) ====================

/**
 * Jalankan sekali untuk mendaftarkan paket default jika sheet Packages kosong.
 * Bisa juga dipanggil ulang untuk menambah paket yang belum ada.
 */
function setupPackages() {
  var pSheet = getSheet(SH.PACKAGES);
  var existing = readAll(pSheet);
  var names = {};
  existing.forEach(function (x) { names[String(x.file_xml)] = true; });

  // Daftar paket awal (tambah sesuai kebutuhan)
  var defaultPackages = [
    { nama: 'Matematika Dasar', file: 'matematika.xml', harga: 0 }
    // { nama: 'IPA Dasar', file: 'ipa.xml', harga: 0 },
    // { nama: 'Bahasa Indonesia', file: 'bindo.xml', harga: 0 }
  ];

  var added = [];
  defaultPackages.forEach(function (pk) {
    if (!names[pk.file]) {
      pSheet.appendRow([generateUUID(), pk.nama, pk.file, pk.harga, '1']);
      added.push(pk.nama);
    }
  });

  Logger.log(added.length ? 'Ditambahkan: ' + added.join(', ') : 'Semua paket sudah terdaftar.');
}
