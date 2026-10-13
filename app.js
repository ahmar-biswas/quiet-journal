(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const DB_NAME = "quiet-voice-journal";
  const STORE = "entries";
  let db, recorder, stream, chunks = [], draftBlob = null, recognition = null;
  let startedAt = 0, ticker = null, liveTranscript = "", activeId = null, currentEntry = null, installPrompt = null;

  const speechSupported = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  $("speechNote").textContent = speechSupported
    ? "Speech recognition is available in this browser, but may use an online service. Offline transcription is not guaranteed. The audio recording is saved locally."
    : "This browser does not provide its own speech recognition interface. Audio can still be recorded locally; use the transcript box to type or paste words. Offline speech-to-text is not available here.";

  function toast(message) {
    $("toast").textContent = message; $("toast").classList.remove("hidden");
    clearTimeout(toast._timer); toast._timer = setTimeout(() => $("toast").classList.add("hidden"), 3200);
  }
  function openDB() {
    return new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) return reject(new Error("Local database is not supported."));
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const database = req.result;
        if (!database.objectStoreNames.contains(STORE)) {
          const store = database.createObjectStore(STORE, {keyPath:"id"});
          store.createIndex("createdAt", "createdAt");
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("Could not open local storage."));
    });
  }
  function tx(mode, action) {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, mode), store = transaction.objectStore(STORE);
      let result;
      try { result = action(store); } catch (e) { reject(e); return; }
      transaction.oncomplete = () => resolve(result && result.result !== undefined ? result.result : result);
      transaction.onerror = () => reject(transaction.error || new Error("Storage failed."));
      transaction.onabort = () => reject(transaction.error || new Error("Storage operation cancelled."));
    });
  }
  function allEntries() {
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result.sort((a,b) => b.createdAt - a.createdAt));
      req.onerror = () => reject(req.error);
    });
  }
  function fmtDate(ts) {
    return new Intl.DateTimeFormat(undefined, {month:"short", day:"numeric", year:"numeric", hour:"numeric", minute:"2-digit"}).format(new Date(ts));
  }
  function duration(ms) { const s = Math.floor(ms/1000); return String(Math.floor(s/60)).padStart(2,"0")+":"+String(s%60).padStart(2,"0"); }
  function safeText(value) { return String(value || "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

  async function renderEntries() {
    const entries = await allEntries(), q = $("searchBox").value.trim().toLowerCase();
    $("entryCount").textContent = entries.length;
    const filtered = entries.filter(e => (e.title+" "+e.transcript).toLowerCase().includes(q));
    $("entriesList").innerHTML = filtered.map(e => `
      <button class="entry-card" data-id="${safeText(e.id)}">
        <span class="entry-icon">${e.audio ? "♫" : "✎"}</span>
        <span class="entry-copy"><p class="entry-title">${safeText(e.title || "Untitled thought")}</p>
        <p class="entry-preview">${safeText(e.transcript || (e.audio ? "Voice recording · no transcript" : "No text"))}</p>
        <span class="entry-date">${safeText(fmtDate(e.createdAt))}${e.audio ? " · audio saved" : ""}</span></span>
      </button>`).join("");
    $("emptyState").classList.toggle("hidden", filtered.length !== 0);
    if (q && filtered.length === 0) $("emptyState").querySelector("h3").textContent = "No matching entries.";
    else $("emptyState").querySelector("h3").textContent = "A little space for you.";
    $("entriesList").querySelectorAll("[data-id]").forEach(btn => btn.addEventListener("click", () => showEntry(btn.dataset.id)));
  }

  function beginSpeechRecognition() {
    const API = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!API) return;
    try {
      recognition = new API();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = navigator.language || "en-US";
      recognition.onresult = event => {
        let finalText = "", interim = "";
        for (let i=0; i<event.results.length; i++) {
          const result = event.results[i];
          if (result.isFinal) finalText += result[0].transcript + " ";
          else interim += result[0].transcript;
        }
        if (finalText) liveTranscript += finalText;
        $("transcript").value = (liveTranscript + interim).trim();
      };
      recognition.onerror = event => {
        if (event.error !== "no-speech" && event.error !== "aborted")
          $("speechNote").textContent = "Speech-to-text stopped (" + event.error + "). Your audio recording can still be saved; edit the transcript if needed.";
      };
      recognition.start();
    } catch (_) {
      $("speechNote").textContent = "Speech-to-text could not start. Audio recording can still be saved; you can edit the transcript.";
    }
  }
  function stopSpeech() {
    if (recognition) { try { recognition.onresult = null; recognition.stop(); } catch (_) {} recognition = null; }
  }

  async function startRecording() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
      toast("Audio recording is not supported in this browser. Try an up-to-date Chrome browser over HTTPS.");
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({audio:true});
      const options = {};
      if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) options.mimeType = "audio/webm;codecs=opus";
      else if (MediaRecorder.isTypeSupported("audio/mp4")) options.mimeType = "audio/mp4";
      recorder = new MediaRecorder(stream, options);
      chunks = []; liveTranscript = ""; $("transcript").value = ""; draftBlob = null;
      recorder.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
      recorder.onerror = () => toast("The recording encountered an error.");
      recorder.onstop = () => {
        draftBlob = new Blob(chunks, {type:recorder.mimeType || "audio/webm"});
        $("draftAudio").src = URL.createObjectURL(draftBlob);
        $("draftAudio").classList.remove("hidden");
        $("draftPanel").classList.remove("hidden");
        $("recordStatus").textContent = "Recording ready. Review it below.";
        $("recordBtn").classList.remove("hidden"); $("stopBtn").classList.add("hidden");
        $("recordBtn").innerHTML = "<span>●</span> Record another";
        stream && stream.getTracks().forEach(t => t.stop()); stream = null;
        renderEntries();
      };
      recorder.start(250);
      startedAt = Date.now();
      $("recordBtn").classList.add("hidden"); $("stopBtn").classList.remove("hidden");
      $("recordStatus").textContent = "Listening. Speak naturally.";
      ticker = setInterval(() => $("timer").textContent = duration(Date.now()-startedAt), 250);
      beginSpeechRecognition();
    } catch (err) {
      toast(err && err.name === "NotAllowedError" ? "Microphone permission was denied. Allow microphone access in browser settings." : "Could not start recording. Check microphone access and try again.");
    }
  }
  function stopRecording() {
    clearInterval(ticker); $("timer").textContent = duration(Date.now()-startedAt);
    stopSpeech();
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }
  function discardDraft() {
    if (draftBlob) { draftBlob = null; }
    $("draftAudio").pause(); $("draftAudio").removeAttribute("src"); $("draftAudio").classList.add("hidden");
    $("draftPanel").classList.add("hidden"); $("entryTitle").value = ""; $("transcript").value = "";
    $("timer").textContent = "00:00"; $("recordStatus").textContent = "Your next thought can start here.";
    $("recordBtn").innerHTML = "<span>●</span> Start recording"; $("recordBtn").classList.remove("hidden"); $("stopBtn").classList.add("hidden");
  }
  async function saveEntry() {
    const transcript = $("transcript").value.trim(), title = $("entryTitle").value.trim();
    if (!transcript && !draftBlob) return toast("Add a transcript or record some audio before saving.");
    const entry = {id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now())+"-"+Math.random().toString(16).slice(2),
      title: title || transcript.split(/\s+/).slice(0,7).join(" ") || "Voice entry",
      transcript, createdAt:Date.now(), audio:draftBlob || null, audioType:draftBlob ? draftBlob.type : null};
    try {
      await tx("readwrite", store => store.put(entry));
      discardDraft(); await renderEntries(); toast("Saved on this device.");
    } catch (e) { toast("Could not save. Your device storage may be full."); }
  }
  async function showEntry(id) {
    const entries = await allEntries(); currentEntry = entries.find(e => e.id === id); if (!currentEntry) return;
    activeId = id;
    $("homeView").classList.add("hidden"); $("detailView").classList.remove("hidden");
    $("detailDate").textContent = fmtDate(currentEntry.createdAt);
    $("detailTitle").textContent = currentEntry.title || "Untitled thought";
    $("detailMeta").textContent = currentEntry.audio ? "VOICE RECORDING · SAVED LOCALLY" : "TEXT ENTRY · SAVED LOCALLY";
    $("detailTranscript").textContent = currentEntry.transcript || "No transcript was saved for this recording.";
    const audio = $("detailAudio");
    if (currentEntry.audio) { audio.src = URL.createObjectURL(currentEntry.audio); audio.classList.remove("hidden"); }
    else { audio.removeAttribute("src"); audio.classList.add("hidden"); }
  }
  function backHome() {
    $("detailAudio").pause(); $("detailAudio").removeAttribute("src");
    $("detailView").classList.add("hidden"); $("homeView").classList.remove("hidden"); activeId = null; currentEntry = null;
  }
  async function editEntry() {
    if (!currentEntry) return;
    const edited = prompt("Edit your transcript:", currentEntry.transcript || "");
    if (edited === null) return;
    currentEntry.transcript = edited;
    if (!currentEntry.title || currentEntry.title === "Voice entry") currentEntry.title = edited.trim().split(/\s+/).slice(0,7).join(" ") || "Voice entry";
    try { await tx("readwrite", s => s.put(currentEntry)); await showEntry(currentEntry.id); await renderEntries(); toast("Entry updated."); }
    catch (_) { toast("Could not update entry."); }
  }
  async function deleteEntry() {
    if (!currentEntry || !confirm("Delete this entry and its saved audio? This cannot be undone.")) return;
    try { await tx("readwrite", s => s.delete(currentEntry.id)); backHome(); await renderEntries(); toast("Entry deleted."); }
    catch (_) { toast("Could not delete entry."); }
  }

  $("recordBtn").addEventListener("click", startRecording);
  $("stopBtn").addEventListener("click", stopRecording);
  $("saveBtn").addEventListener("click", saveEntry);
  $("discardBtn").addEventListener("click", discardDraft);
  $("searchBox").addEventListener("input", renderEntries);
  $("backBtn").addEventListener("click", backHome);
  $("editBtn").addEventListener("click", editEntry);
  $("deleteBtn").addEventListener("click", deleteEntry);
  $("todayLabel").textContent = new Intl.DateTimeFormat(undefined, {weekday:"long", month:"long", day:"numeric"}).format(new Date()).toUpperCase();

  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault(); installPrompt = event; $("installBtn").classList.remove("hidden");
  });
  $("installBtn").addEventListener("click", async () => {
    if (!installPrompt) { toast("In Chrome, open the menu and choose Install app or Add to Home screen."); return; }
    installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; $("installBtn").classList.add("hidden");
  });
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {
      $("offlineStatus").textContent = "OFFLINE CACHE UNAVAILABLE";
    }));
  }
  openDB().then(async database => { db = database; await renderEntries(); })
    .catch(() => { toast("Local storage could not be opened. Use a current browser with site storage enabled."); });
})();