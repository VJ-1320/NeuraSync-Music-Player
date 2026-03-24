/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import { 
  Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, 
  Mic, Monitor, Music as MusicIcon, Maximize2, Settings, HelpCircle,
  Timer, Zap, Activity, Layers, Search, Trash2, X
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { App as CapacitorApp } from "@capacitor/app";
import { MediaSession } from "capacitor-media-session";
import { FilePicker } from "@capawesome/capacitor-file-picker";
import { CapacitorUpdater } from "@capgo/capacitor-updater";

const GlyphPlugin = registerPlugin<any>("GlyphPlugin");

// ─── Helpers ──────────────────────────────────────────────────────────────────
function hexToRgba(hex: string, a: number) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

function fmt(sec: number) {
  if (!sec || isNaN(sec) || !isFinite(sec)) return "0:00";
  const minutes = Math.floor(sec / 60);
  const seconds = Math.floor(sec % 60);
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function makePart(i: number, n: number) {
  return {
    angle: (i / n) * Math.PI * 2 + (Math.random() - 0.5) * 0.4,
    baseR: 92 + Math.random() * 28,
    speed: 0.0018 + Math.random() * 0.006,
    size: 0.6 + Math.random() * 1.8,
    phase: Math.random() * Math.PI * 2,
  };
}

// ─── Data ─────────────────────────────────────────────────────────────────────
interface Track {
  title: string;
  sub: string;
  dur: number;
  E: number;
  src: string;
}

const MOODS = [
  { id: "focus",    label: "FOCUS",    color: "#00ffb3" },
  { id: "sleep",    label: "SLEEP",    color: "#4499ff" },
  { id: "energy",   label: "ENERGY",   color: "#ff5533" },
  { id: "meditate", label: "MEDITATE", color: "#cc55ff" },
];

const PARTS = 32;

// ─── Component ────────────────────────────────────────────────────────────────
export default function App() {
  // playback
  const [playing,  setPlaying]  = useState(false);
  const [tracks,   setTracks]   = useState<Track[]>([]);
  const [tidx,     setTidx]     = useState(0);
  const [progress, setProgress] = useState(0);
  const [volume,   setVolume]   = useState(0.8);
  const [muted,    setMuted]    = useState(false);
  const lastPeakTimeRef = useRef<number>(0);
  const peakIntervalsRef = useRef<number[]>([]);
  const [captureMode, setCaptureMode] = useState(false);
  const [micMode, setMicMode] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  
  // audio refs
  const audioRef      = useRef<HTMLAudioElement>(null);
  const fileInputRef  = useRef<HTMLInputElement>(null);
  const audioCtxRef   = useRef<AudioContext | null>(null);
  const analyserRef   = useRef<AnalyserNode | null>(null);
  const sourceRef     = useRef<MediaElementAudioSourceNode | null>(null);
  const micSourceRef   = useRef<MediaStreamAudioSourceNode | null>(null);
  const outputGainRef  = useRef<GainNode | null>(null);
  const sleepFilterRef = useRef<BiquadFilterNode | null>(null);
  const wakeLockRef    = useRef<any>(null);
  const filterNodesRef = useRef<BiquadFilterNode[]>([]);
  const dataArrayRef  = useRef<Uint8Array | null>(null);
  
  // ui
  const [moods,       setMoods]       = useState<Record<number, string>>({});
  const [shortcuts,   setShortcuts]   = useState(false);
  const [ambient,     setAmbient]     = useState(false);
  const [ambientStyle, setAmbientStyle] = useState<"RINGS" | "NEBULA" | "GRID" | "HORIZON" | "BREATHE">("RINGS");
  const [showEq,      setShowEq]      = useState(false);
  const [autoEq,      setAutoEq]      = useState(true);
  const [eqGains,     setEqGains]     = useState<number[]>([0, 0, 0, 0, 0]); // 60, 230, 910, 3600, 14000 Hz
  const autoEqBassRef = useRef(0);
  const [trans,       setTrans]       = useState(false);   
  const [sessionMins, setSessionMins] = useState(0);
  const [sessElapsed, setSessElapsed] = useState(0);
  const [showSess,    setShowSess]    = useState(false);
  const [bpm,         setBpm]         = useState<number | null>(null);
  const [autoBpm,     setAutoBpm]     = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [showLibrary, setShowLibrary] = useState(false);
  const [showBatteryPrompt, setShowBatteryPrompt] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);
  
  const bassRef       = useRef(0);
  const bumpRef       = useRef(0);

  const track = tracks[tidx] || { title: "NO_TRACK_LOADED", sub: "PLEASE_LOAD_FILES", dur: 0, E: 0.4, src: "" };
  const moodColor = MOODS.find(m => m.id === moods[tidx])?.color ?? "#00ffb3";

  // canvas
  const discRef    = useRef<HTMLCanvasElement>(null);
  const barsRef    = useRef<HTMLCanvasElement>(null);
  const spectroRef = useRef<HTMLCanvasElement>(null);
  const ambRef     = useRef<HTMLCanvasElement>(null);
  
  // dom
  const cardRef      = useRef<HTMLDivElement>(null);
  
  // anim state
  const energyRef  = useRef(0);
  const burstRef   = useRef(0);
  const horizonParts = useRef<{ x: number; y: number }[]>([]);
  const parts      = useRef(Array.from({ length: PARTS }, (_, i) => makePart(i, PARTS)));
  const playRef    = useRef(false);
  const progRef    = useRef(0);
  const bpmTaps    = useRef<number[]>([]);
  const lastPulseRef = useRef(0);
  
  // drag-to-seek
  const dragging   = useRef(false);
  const dragCenter = useRef({ x: 0, y: 0 });
  const dragAngle  = useRef(0);
  const dragProg   = useRef(0);

  const changeTrack = useCallback((dir: number) => {
    setTrans(true);
    setTimeout(() => {
      setTidx(i => (i + dir + tracks.length) % tracks.length);
      setProgress(0);
      setSessElapsed(0);
      setBpm(null);
      setTimeout(() => setTrans(false), 50);
    }, 350);
  }, [tracks.length]);

  const handleAudioError = useCallback(() => {
    if (captureMode || micMode) return;
    console.error("Audio error at index:", tidx);
    setAudioError("FILE CORRUPTED // SKIPPING...");
    setTimeout(() => {
      changeTrack(1);
    }, 2000);
  }, [captureMode, micMode, tidx, changeTrack]);

  const handleFolderSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const audioFiles = Array.from(files).filter((file: File) => 
      file.type.startsWith('audio/') || 
      /\.(mp3|wav|flac|ogg|m4a)$/i.test(file.name)
    );

    if (audioFiles.length === 0) {
      setAudioError("NO AUDIO FILES FOUND");
      return;
    }

    const newTracks: Track[] = audioFiles.map((file: File) => ({
      title: file.name.replace(/\.[^/.]+$/, "").toUpperCase(),
      sub: "LOCAL_FILE // " + (file.type.split('/')[1] || "AUDIO").toUpperCase(),
      dur: 0,
      E: 0.4 + Math.random() * 0.5,
      src: URL.createObjectURL(file)
    }));

    setTracks(prev => {
      const updated = [...prev, ...newTracks];
      localStorage.setItem('NEURASYNC_REGISTRY', JSON.stringify(updated));
      return updated;
    });
    setAudioError(null);
  }, []);

  const onLoadFolderClick = useCallback(async () => {
    if (audioCtxRef.current?.state === 'suspended') {
      audioCtxRef.current.resume();
    }
    if (Capacitor.isNativePlatform()) {
      try {
        const result = await FilePicker.pickFiles({
          types: ['audio/mpeg', 'audio/wav', 'audio/flac', 'audio/ogg', 'audio/aac'],
          readData: false
        });
        
        if (result.files.length === 0) return;

        const newTracks: Track[] = result.files.map(file => ({
          title: file.name.replace(/\.[^/.]+$/, "").toUpperCase(),
          sub: "LOCAL_FILE // MOBILE",
          dur: 0,
          E: 0.4 + Math.random() * 0.5,
          src: Capacitor.convertFileSrc(file.path || '')
        }));

        setTracks(prev => {
          const updated = [...prev, ...newTracks];
          localStorage.setItem('NEURASYNC_REGISTRY', JSON.stringify(updated));
          return updated;
        });
        setAudioError(null);
      } catch (err) {
        console.error("Mobile file pick failed:", err);
        setAudioError("MOBILE FILE PICK FAILED");
      }
    } else {
      fileInputRef.current?.click();
    }
  }, []);

  const deleteTrack = useCallback((index: number) => {
    setTracks(prev => {
      const updated = prev.filter((_, i) => i !== index);
      localStorage.setItem('NEURASYNC_REGISTRY', JSON.stringify(updated));
      return updated;
    });
    setNotification("REGISTRY UPDATED");
    if (tidx >= index && tidx > 0) {
      setTidx(prev => prev - 1);
    }
  }, [tidx]);

  // Persistence: Load on mount
  useEffect(() => {
    const saved = localStorage.getItem('NEURASYNC_REGISTRY');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) setTracks(parsed);
      } catch (e) {
        console.error("Failed to parse registry", e);
      }
    }
  }, []);

  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 2000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  // Memory Management: Cleanup ObjectURLs on unmount
  useEffect(() => {
    return () => {
      tracks.forEach(t => {
        if (t.src.startsWith('blob:')) URL.revokeObjectURL(t.src);
      });
    };
  }, [tracks]);

  useEffect(() => { progRef.current = progress; }, [progress]);
  
  // OTA Updates
  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      // Notify the native side that the app is ready to receive updates
      CapacitorUpdater.notifyAppReady();

      const checkForUpdates = async () => {
        try {
          const update = await CapacitorUpdater.download({
            url: "https://api.capgo.app/v1/update", // Placeholder URL, replace with your Capgo endpoint
            version: "latest", // Required property
          });
          
          if (update) {
            console.log("Update downloaded, will be applied on next restart.");
            // Optionally, you can call CapacitorUpdater.set(update) to apply immediately
          }
        } catch (error) {
          console.error("OTA update check failed:", error);
        }
      };

      checkForUpdates();
    }
  }, []);

  // Glyph Initialization
  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      GlyphPlugin.initGlyph().catch((e: any) => console.error("Glyph init failed", e));
      
      // Battery Optimization Check
      const checkBattery = async () => {
        const hasPrompted = localStorage.getItem('NEURASYNC_BATTERY_PROMPT');
        if (!hasPrompted) {
          setShowBatteryPrompt(true);
        }
      };
      checkBattery();
    }
    return () => {
      if (Capacitor.isNativePlatform()) {
        GlyphPlugin.closeGlyph().catch((e: any) => console.error("Glyph close failed", e));
      }
    };
  }, []);

  // ─── Audio Logic ──────────────────────────────────────────────────────────
  
  const initAudio = useCallback(async () => {
    if (audioCtxRef.current) return;
    
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.6;
    
    // Create EQ Filters
    const freqs = [60, 230, 910, 3600, 14000];
    const filters = freqs.map((freq, i) => {
      const filter = ctx.createBiquadFilter();
      filter.type = i === 0 ? "lowshelf" : i === 4 ? "highshelf" : "peaking";
      filter.frequency.value = freq;
      filter.gain.value = eqGains[i];
      filter.Q.value = 1;
      return filter;
    });

    // Output Gain (to prevent feedback during capture)
    const outputGain = ctx.createGain();
    outputGain.connect(ctx.destination);
    outputGainRef.current = outputGain;

    // Sleep Filter (Low-pass)
    const sleepFilter = ctx.createBiquadFilter();
    sleepFilter.type = "lowpass";
    sleepFilter.frequency.value = 20000;
    sleepFilterRef.current = sleepFilter;

    // Connect Filter Chain
    for (let i = 0; i < filters.length - 1; i++) {
      filters[i].connect(filters[i + 1]);
    }
    filters[filters.length - 1].connect(sleepFilter);
    sleepFilter.connect(analyser);
    analyser.connect(outputGain);
    
    audioCtxRef.current = ctx;
    analyserRef.current = analyser;
    filterNodesRef.current = filters;
    dataArrayRef.current = new Uint8Array(analyser.frequencyBinCount);

    if (audioRef.current && !sourceRef.current) {
      try {
        const source = ctx.createMediaElementSource(audioRef.current);
        source.connect(filters[0]);
        sourceRef.current = source;
      } catch (e) {
        console.warn("Audio source connection failed:", e);
      }
    }
  }, [eqGains]);

  const updateEq = (index: number, val: number) => {
    const newGains = [...eqGains];
    newGains[index] = val;
    setEqGains(newGains);
    if (filterNodesRef.current[index]) {
      filterNodesRef.current[index].gain.setTargetAtTime(val, audioCtxRef.current?.currentTime || 0, 0.1);
    }
  };

  const toggleMic = async () => {
    setAudioError(null);
    if (!micMode) {
      try {
        await initAudio();
        if (audioCtxRef.current?.state === 'suspended') {
          await audioCtxRef.current.resume();
        }

        // Mute output to prevent feedback
        if (outputGainRef.current) {
          outputGainRef.current.gain.setTargetAtTime(0, audioCtxRef.current!.currentTime, 0.01);
        }

        const stream = await navigator.mediaDevices.getUserMedia({ 
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false
          } 
        });

        if (audioCtxRef.current && filterNodesRef.current[0]) {
          if (micSourceRef.current) micSourceRef.current.disconnect();
          const micSource = audioCtxRef.current.createMediaStreamSource(stream);
          micSource.connect(filterNodesRef.current[0]);
          micSourceRef.current = micSource;
          setMicMode(true);
          setCaptureMode(false);
          setPlaying(true);
        }
      } catch (err: any) {
        console.error("Mic capture failed:", err);
        if (outputGainRef.current) {
          outputGainRef.current.gain.setTargetAtTime(1, audioCtxRef.current!.currentTime, 0.01);
        }
        setAudioError("Microphone access denied. Please allow microphone permissions.");
      }
    } else {
      if (outputGainRef.current) {
        outputGainRef.current.gain.setTargetAtTime(1, audioCtxRef.current!.currentTime, 0.01);
      }
      if (micSourceRef.current) {
        micSourceRef.current.disconnect();
        micSourceRef.current = null;
      }
      setMicMode(false);
      setPlaying(false);
    }
  };

  const toggleCapture = async () => {
    setAudioError(null);
    
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      setAudioError("System capture is not supported on this browser or device.");
      return;
    }

    if (!captureMode) {
      try {
        await initAudio();
        if (audioCtxRef.current?.state === 'suspended') {
          await audioCtxRef.current.resume();
        }

        // Mute output to prevent feedback
        if (outputGainRef.current) {
          outputGainRef.current.gain.setTargetAtTime(0, audioCtxRef.current!.currentTime, 0.01);
        }

        const stream = await navigator.mediaDevices.getDisplayMedia({ 
          video: true, 
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false
          } as any,
          // @ts-ignore
          systemAudio: 'include' 
        });

        const audioTracks = stream.getAudioTracks();
        if (audioTracks.length === 0) {
          stream.getTracks().forEach(t => t.stop());
          throw new Error("NO_AUDIO_TRACK");
        }
        
        if (audioCtxRef.current && filterNodesRef.current[0]) {
          if (micSourceRef.current) micSourceRef.current.disconnect();
          const micSource = audioCtxRef.current.createMediaStreamSource(stream);
          micSource.connect(filterNodesRef.current[0]);
          micSourceRef.current = micSource;
          
          setCaptureMode(true);
          setMicMode(false);
          setPlaying(true);
          
          stream.getVideoTracks().forEach(track => track.stop());

          audioTracks[0].onended = () => {
            setCaptureMode(false);
            setPlaying(false);
            if (outputGainRef.current) {
              outputGainRef.current.gain.setTargetAtTime(1, audioCtxRef.current!.currentTime, 0.01);
            }
          };
        }
      } catch (err: any) {
        console.error("System capture failed:", err);
        if (outputGainRef.current) {
          outputGainRef.current.gain.setTargetAtTime(1, audioCtxRef.current!.currentTime, 0.01);
        }
        
        if (err.message === "NO_AUDIO_TRACK") {
          setAudioError("NO_AUDIO_TRACK: You must check 'Share system audio' in the popup.");
        } else if (err.name === 'NotAllowedError' || err.name === 'SecurityError') {
          setAudioError("PERMISSION_DENIED: Try opening in a NEW TAB to bypass iframe restrictions.");
        } else {
          setAudioError(`CAPTURE_ERROR: ${err.message || "Unknown error"}`);
        }
      }
    } else {
      if (outputGainRef.current) {
        outputGainRef.current.gain.setTargetAtTime(1, audioCtxRef.current!.currentTime, 0.01);
      }
      if (micSourceRef.current) {
        micSourceRef.current.disconnect();
        micSourceRef.current = null;
      }
      setCaptureMode(false);
      setPlaying(false);
    }
  };

  useEffect(() => {
    if (!audioRef.current) return;
    if (captureMode || micMode) return;
    
    const audio = audioRef.current;
    const targetSrc = tracks[tidx]?.src;
    
    if (playing && targetSrc) {
      initAudio();
      if (audioCtxRef.current?.state === 'suspended') {
        audioCtxRef.current.resume();
      }
      
      // Ensure output gain is active if not in capture mode
      if (!captureMode && !micMode && outputGainRef.current) {
        outputGainRef.current.gain.setTargetAtTime(1, audioCtxRef.current!.currentTime, 0.01);
      }
      if (audio.getAttribute('src') !== targetSrc) {
        audio.src = targetSrc;
        audio.load();
      }
      
      // Small delay to ensure the browser has processed the src change
      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise.catch(e => {
          if (e.name !== "AbortError") {
            console.error("Playback failed:", e);
            setAudioError("Playback failed. The resource might be blocked or unavailable.");
            setPlaying(false);
          }
        });
      }
    } else {
      audio.pause();
    }
    playRef.current = playing;
  }, [playing, tidx, initAudio, captureMode]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = muted ? 0 : volume;
    }
  }, [volume, muted]);

  // Reset error when track changes
  useEffect(() => {
    setAudioError(null);
  }, [tidx]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const updateProgress = () => {
      if (audio.duration && !captureMode) {
        setProgress(audio.currentTime / audio.duration);
      }
    };

    const handleLoadedMetadata = () => {
      if (audio.duration && !captureMode) {
        setTracks(prev => {
          const next = [...prev];
          if (next[tidx] && next[tidx].dur === 0) {
            next[tidx] = { ...next[tidx], dur: audio.duration };
          }
          return next;
        });
      }
    };

    const handleEnded = () => {
      if (!captureMode) {
        changeTrack(1);
      }
    };

    audio.addEventListener('timeupdate', updateProgress);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    
    return () => {
      audio.removeEventListener('timeupdate', updateProgress);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
    };
  }, [captureMode, tidx, changeTrack]);

  // Analysis Loop
  useEffect(() => {
    let raf: number;
    const analyze = () => {
      if (!playing) return;
      raf = requestAnimationFrame(analyze);
      
      let B = 0;
      if (analyserRef.current && dataArrayRef.current) {
        analyserRef.current.getByteFrequencyData(dataArrayRef.current);
        
        // Auto-EQ Monitoring Loop
        if (autoEq) {
          const data = dataArrayRef.current;
          // Monitor lowSum (0-100Hz) - bins 0 to 4 approx for 1024 FFT
          let lowSum = 0; 
          for (let i = 0; i < 4; i++) lowSum += data[i];
          const lowAvg = lowSum / 4;
          
          // Median spectrum for comparison
          let totalSum = 0;
          for (let i = 0; i < 512; i++) totalSum += data[i];
          const median = totalSum / 512;
          
          const threshold = 22; // ~6dB
          if (lowAvg > median + threshold) {
            const diff = lowAvg - (median + threshold);
            const attenuation = Math.min(15, diff * 0.6);
            autoEqBassRef.current += (attenuation - autoEqBassRef.current) * 0.15;
          } else {
            autoEqBassRef.current *= 0.92;
          }
          
          if (filterNodesRef.current[0]) {
            const targetGain = eqGains[0] - autoEqBassRef.current;
            filterNodesRef.current[0].gain.setTargetAtTime(targetGain, audioCtxRef.current?.currentTime || 0, 0.05);
          }
        }

        // Energy calculation
        let sum = 0;
        for (let i = 0; i < dataArrayRef.current.length; i++) {
          sum += dataArrayRef.current[i];
        }
        const avg = sum / dataArrayRef.current.length;
        const targetE = avg / 64; 
        energyRef.current += (targetE - energyRef.current) * 0.2;

        // Trigger Glyph Intensity Pulse (Throttled to 150ms)
        const now = performance.now();
        if (Capacitor.isNativePlatform() && now - lastPulseRef.current > 150) {
          GlyphPlugin.triggerIntensityPulse({ brightness: Math.round(avg) }).catch(() => {});
          lastPulseRef.current = now;
        }

        // Bass Bump calculation (20Hz - 100Hz approx bins 0-4 for 256 FFT)
        let bassSum = 0;
        for (let i = 0; i < 4; i++) {
          bassSum += dataArrayRef.current[i];
        }
        const bassAvg = bassSum / 4;
        const targetBump = Math.pow(bassAvg / 255, 2) * 1.5; // Exponential for better kick feel
        bumpRef.current += (targetBump - bumpRef.current) * 0.3;
        B = bumpRef.current;
      } else {
        energyRef.current *= 0.95;
        bumpRef.current *= 0.95;
        B = bumpRef.current;
      }

      // Apply Transform to Card (Stabilized Pulse)
      if (cardRef.current) {
        // Strictly scale based on bass energy to prevent vibration
        const scale = 1 + B * 0.03;
        cardRef.current.style.transform = `scale(${scale})`;
      }

      if (analyserRef.current && dataArrayRef.current) {
        const E = energyRef.current;
        // BPM Detection Logic (Peak detection)
        if (E > 0.85 || B > 0.8) { // Threshold for a beat or heavy bass
          const now = performance.now();
          
          const delta = now - lastPeakTimeRef.current;
          if (delta > 300 && delta < 1500) { // Limit to reasonable BPM range (40-200)
            burstRef.current = 1.0; // Trigger explosive burst
            peakIntervalsRef.current.push(delta);
            if (peakIntervalsRef.current.length > 8) peakIntervalsRef.current.shift();
            
            const avgInterval = peakIntervalsRef.current.reduce((a, b) => a + b, 0) / peakIntervalsRef.current.length;
            const detectedBpm = Math.round(60000 / avgInterval);
            setAutoBpm(detectedBpm);
            lastPeakTimeRef.current = now;
          } else if (delta > 1500) {
            lastPeakTimeRef.current = now; // Reset if too long
          }
        }
      } else if (!playing) {
         energyRef.current *= 0.95;
      }
    };
    raf = requestAnimationFrame(analyze);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  // Session Timer
  useEffect(() => {
    if (!playing || sessionMins <= 0) return;
    const id = setInterval(() => {
      setSessElapsed(e => {
        const ne = e + 0.1;
        const totalSec = sessionMins * 60;
        const remaining = totalSec - ne;

        // Sleep Fade Logic (final 60s)
        if (remaining <= 60 && remaining > 0) {
          const progress = 1 - (remaining / 60); // 0 to 1
          if (outputGainRef.current && audioCtxRef.current) {
            const now = audioCtxRef.current.currentTime;
            // Ramp down volume
            outputGainRef.current.gain.setTargetAtTime(volume * (1 - progress), now, 0.1);
          }
          if (sleepFilterRef.current && audioCtxRef.current) {
            const now = audioCtxRef.current.currentTime;
            // Sweep low-pass filter from 20kHz to 400Hz
            const freq = 20000 * Math.pow(400 / 20000, progress);
            sleepFilterRef.current.frequency.setTargetAtTime(freq, now, 0.1);
          }
        }

        if (ne >= totalSec) { 
          setPlaying(false); 
          // Reset gains/filters for next session
          if (outputGainRef.current && audioCtxRef.current) {
            outputGainRef.current.gain.setTargetAtTime(volume, audioCtxRef.current.currentTime, 0.1);
          }
          if (sleepFilterRef.current && audioCtxRef.current) {
            sleepFilterRef.current.frequency.setTargetAtTime(20000, audioCtxRef.current.currentTime, 0.1);
          }
          return 0; 
        }
        return ne;
      });
    }, 100);
    return () => clearInterval(id);
  }, [playing, sessionMins, volume]);

  // Wake Lock & Foreground Service
  useEffect(() => {
    if (playing && Capacitor.isNativePlatform()) {
      const requestWakeLock = async () => {
        try {
          if ('wakeLock' in navigator) {
            wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
          }
          // Request foreground service and wake lock via GlyphPlugin
          await GlyphPlugin.startForegroundService({
            title: "NEURAL_SYNC ACTIVE",
            text: "OPTIMIZING_BACKGROUND_RELIABILITY..."
          });
        } catch (err) {
          console.error("WakeLock/ForegroundService failed:", err);
        }
      };
      requestWakeLock();
    } else {
      if (wakeLockRef.current) {
        wakeLockRef.current.release();
        wakeLockRef.current = null;
      }
      if (Capacitor.isNativePlatform()) {
        GlyphPlugin.stopForegroundService().catch(() => {});
      }
    }
  }, [playing]);

  const togglePlay = useCallback(() => {
    if (audioCtxRef.current?.state === 'suspended') {
      audioCtxRef.current.resume();
    }
    setPlaying(p => !p);
  }, []);

  // ─── Native Integrations ──────────────────────────────────────────────────────
  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      // 1. Media Session Action Handlers
      const playListener = MediaSession.addListener('play', () => {
        if (!playing) togglePlay();
      });
      const pauseListener = MediaSession.addListener('pause', () => {
        if (playing) togglePlay();
      });
      const nextListener = MediaSession.addListener('nexttrack', () => changeTrack(1));
      const prevListener = MediaSession.addListener('previoustrack', () => changeTrack(-1));

      // 2. Overlay Permission Check & Request
      const initOverlay = async () => {
        try {
          const { granted } = await GlyphPlugin.checkOverlayPermission();
          if (!granted) {
            await GlyphPlugin.requestOverlayPermission();
          }
        } catch (e) {
          console.error("Overlay permission check failed:", e);
        }
      };
      initOverlay();

      // 3. App State Change (Dynamic Island Trigger)
      let appStateListener: any;
      const setupAppState = async () => {
        appStateListener = await CapacitorApp.addListener('appStateChange', ({ isActive }) => {
          if (!isActive && playing) {
            const track = tracks[tidx];
            GlyphPlugin.showOverlay({
              trackTitle: track?.title || "NEURAL_SYNC",
              moodColor: moodColor
            }).catch(e => console.error("Overlay error:", e));
          } else {
            GlyphPlugin.hideOverlay().catch(() => {});
          }
        });
      };
      setupAppState();

      return () => {
        playListener.remove();
        pauseListener.remove();
        nextListener.remove();
        prevListener.remove();
        if (appStateListener) appStateListener.remove();
      };
    }
  }, [playing, tidx, tracks, moodColor, togglePlay, changeTrack]);

  // 4. Media Session Metadata Sync
  useEffect(() => {
    if (Capacitor.isNativePlatform() && tracks.length > 0) {
      const track = tracks[tidx];
      if (track) {
        MediaSession.setMetadata({
          title: track.title,
          artist: track.artist,
          album: "NEURAL_SYNC",
          artwork: [
            {
              src: "https://picsum.photos/seed/" + encodeURIComponent(track.title) + "/512/512",
              sizes: "512x512",
              type: "image/jpeg"
            }
          ]
        }).catch(e => console.error("MediaSession Metadata error:", e));
      }

      // Note: setPlaybackState might not be in the type definition but is often available
      if ((MediaSession as any).setPlaybackState) {
        (MediaSession as any).setPlaybackState({
          state: playing ? 'playing' : 'paused'
        }).catch((e: any) => console.error("MediaSession State error:", e));
      }
    }
  }, [tidx, playing, tracks]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (dragging.current) {
      const touch = e.touches[0];
      const { x: cx, y: cy } = dragCenter.current;
      const a = Math.atan2(touch.clientY - cy, touch.clientX - cx);
      let d = a - dragAngle.current;
      if (d >  Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      dragAngle.current = a;
      dragProg.current = Math.max(0, Math.min(1, dragProg.current + d / (Math.PI * 2)));
      setProgress(dragProg.current);
      if (audioRef.current && audioRef.current.duration) {
          audioRef.current.currentTime = dragProg.current * audioRef.current.duration;
      }
    }
  }, []);

  const onTouchEnd = useCallback(() => { dragging.current = false; }, []);

  const startTouchDrag = useCallback((e: React.TouchEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const touch = e.touches[0];
    dragging.current      = true;
    dragCenter.current    = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    dragAngle.current     = Math.atan2(touch.clientY - dragCenter.current.y, touch.clientX - dragCenter.current.x);
    dragProg.current      = progRef.current;
  }, []);

  const touchSeek = useCallback((e: React.TouchEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    const touch = e.touches[0];
    const p = Math.max(0, Math.min(1, (touch.clientX - r.left) / r.width));
    setProgress(p);
    if (audioRef.current && audioRef.current.duration) {
        audioRef.current.currentTime = p * audioRef.current.duration;
    }
  }, []);

  const seek = useCallback((e: React.MouseEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    const p = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    setProgress(p);
    if (audioRef.current && audioRef.current.duration) {
        audioRef.current.currentTime = p * audioRef.current.duration;
    }
  }, []);

  // ── Disc canvas ───────────────────────────────────────────────────────────
  useEffect(() => {
    const cv  = discRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    
    const W = cv.width, H = cv.height;
    const cx = W / 2, cy = H / 2;
    let raf: number;
    
    const draw = (ts: number) => {
      if (!playing) return;
      raf = requestAnimationFrame(draw);
      const t  = ts * 0.001;
      const E = energyRef.current;
      const B = bumpRef.current;
      
      // Decay burst intensity
      burstRef.current *= 0.94;
      const burst = burstRef.current;

      ctx.clearRect(0, 0, W, H);

      // Central Glow
      const glowSize = 40 + B * 30;
      const glowGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowSize);
      glowGrad.addColorStop(0, hexToRgba(moodColor, 0.15 + B * 0.2));
      glowGrad.addColorStop(1, "transparent");
      ctx.fillStyle = glowGrad;
      ctx.fillRect(0, 0, W, H);

      parts.current.forEach(p => {
        // Explosive multipliers
        const speedMult = 1 + burst * 3.5;
        const radiusMult = 1 + burst * 0.6;

        p.angle += p.speed * (0.5 + E * 2.8) * speedMult;
        const rOsc = Math.sin(t * 1.6 + p.phase) * E * 20;
        const r  = (p.baseR + rOsc) * radiusMult;
        const px = cx + Math.cos(p.angle) * r;
        const py = cy + Math.sin(p.angle) * r;
        const a  = (0.08 + E * 0.32) * (0.5 + Math.sin(t * 0.9 + p.phase) * 0.5);
        ctx.beginPath();
        ctx.arc(px, py, p.size, 0, Math.PI * 2);
        ctx.fillStyle = hexToRgba(moodColor, a);
        ctx.fill();
      });

      for (let ring = 0; ring < 6; ring++) {
        const baseR = 36 + ring * 16;
        const steps = 120; 
        ctx.beginPath();
        for (let i = 0; i <= steps; i++) {
          const a = (i / steps) * Math.PI * 2;
          const w =
            Math.sin(a * (3 + ring) + t * (1.0 + ring * 0.28)) * (E * 10 + B * 15) +
            Math.sin(a * 13 + t * 0.85) * E * 3.5;
          const rr = baseR + w;
          const x  = cx + Math.cos(a) * rr;
          const y  = cy + Math.sin(a) * rr;
          i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.strokeStyle = hexToRgba(moodColor, 0.055 + (6 - ring) * 0.022 + E * 0.1 + B * 0.05);
        ctx.lineWidth = 1 + B * 1.5;
        ctx.stroke();
      }

      const dg = ctx.createRadialGradient(cx - 4, cy - 4, 0, cx, cy, 42);
      dg.addColorStop(0, "#1c1c1c");
      dg.addColorStop(1, "#050505");
      ctx.beginPath();
      ctx.arc(cx, cy, 42, 0, Math.PI * 2);
      ctx.fillStyle = dg;
      ctx.fill();

      for (let g = 1; g <= 5; g++) {
        ctx.beginPath();
        ctx.arc(cx, cy, g * 7.5, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(255,255,255,0.022)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, 9);
      cg.addColorStop(0, hexToRgba(moodColor, 0.5 + E * 0.45));
      cg.addColorStop(1, "transparent");
      ctx.beginPath();
      ctx.arc(cx, cy, 9, 0, Math.PI * 2);
      ctx.fillStyle = cg;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx, cy, 3.2, 0, Math.PI * 2);
      ctx.fillStyle = hexToRgba(moodColor, 0.75 + E * 0.25);
      ctx.fill();
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [playing, track.E, moodColor, captureMode]);

  // ── Frequency bars ────────────────────────────────────────────────────────
  useEffect(() => {
    const cv  = barsRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    
    const resize = () => {
      const parent = cv.parentElement;
      if (parent) {
        cv.width = parent.clientWidth;
        cv.height = parent.clientHeight;
      }
    };
    resize();
    const ro = new ResizeObserver(resize);
    if (cv.parentElement) ro.observe(cv.parentElement);
    
    const N = 128;
    const barHeights = new Float32Array(N);
    let raf: number;
    
    const draw = (ts: number) => {
      if (!playing) return;
      raf = requestAnimationFrame(draw);
      const W = cv.width, H = cv.height;
      if (W === 0 || H === 0) return;
      
      const data = dataArrayRef.current;
      if (!data) return;

      const E = energyRef.current;
      const B = bumpRef.current;
      ctx.clearRect(0, 0, W, H);
      
      const bw = W / N;
      for (let i = 0; i < N; i++) {
        const targetH = (data[i] / 255) * H * 0.9;
        // Smooth decay
        if (targetH > barHeights[i]) {
          barHeights[i] = targetH;
        } else {
          barHeights[i] -= (barHeights[i] - targetH) * 0.15;
        }

        const h = Math.max(2, barHeights[i]);
        const x = i * bw;
        const y = H - h;
        
        const g = ctx.createLinearGradient(x, y, x, H);
        // Dynamic coloring based on frequency
        const hueShift = (i / N) * 40;
        g.addColorStop(0, moodColor);
        g.addColorStop(1, hexToRgba(moodColor, 0));
        
        ctx.save();
        if (E > 0.6 || B > 0.5) {
          ctx.shadowBlur = (10 * E) + (10 * B);
          ctx.shadowColor = moodColor;
        }
        ctx.fillStyle = g;
        ctx.fillRect(x + 0.5, y, bw - 1, h);
        ctx.restore();
      }
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [moodColor, playing]);

  // ── Spectrogram waterfall ─────────────────────────────────────────────────
  useEffect(() => {
    const cv  = spectroRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    
    const W = cv.width, H = cv.height;
    const buf  = document.createElement("canvas");
    buf.width  = W; buf.height = H;
    const bctx = buf.getContext("2d");
    if (!bctx) return;
    
    let raf: number, lastShift = 0;
    const draw = (ts: number) => {
      if (!playing) return;
      raf = requestAnimationFrame(draw);
      const t = ts * 0.001;
      const E = energyRef.current;
      const data = dataArrayRef.current;

      if (ts - lastShift > 45) {
        lastShift = ts;
        bctx.clearRect(0, 0, W, H);
        bctx.drawImage(cv, -2, 0);
        ctx.clearRect(0, 0, W, H);
        ctx.drawImage(buf, 0, 0);

        if (data) {
          const step = data.length / H;
          for (let y = 0; y < H; y++) {
            const dataIdx = Math.floor(y * step);
            const val = data[dataIdx] / 255;
            
            // Logarithmic-like scaling for better visual distribution
            const intensity = Math.pow(val, 1.5) * E * 1.5;

            if (intensity > 0.01) {
              const hue = moodColor === "#00ffb3" ? 162 : moodColor === "#4499ff" ? 220 : moodColor === "#ff5533" ? 15 : 278;
              ctx.fillStyle = `hsla(${hue}, 100%, ${10 + intensity * 60}%, ${Math.min(1, intensity * 1.2)})`;
              ctx.fillRect(W - 3, y, 3, 1);
            }
          }
        }
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [moodColor, playing]);

  // ── Ambient mode ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!ambient) return;
    const cv  = ambRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    
    const resize = () => { cv.width = window.innerWidth; cv.height = window.innerHeight; };
    resize();
    window.addEventListener("resize", resize);
    
    let raf: number;
    const draw = (ts: number) => {
      if (!playing) return;
      raf = requestAnimationFrame(draw);
      const t = ts * 0.001;
      const E = energyRef.current;
      const W = cv.width, H = cv.height;
      const cx = W / 2, cy = H / 2;
      
      ctx.fillStyle = "rgba(0,0,0,0.15)";
      ctx.fillRect(0, 0, W, H);

      if (ambientStyle === "BREATHE") {
        const currentBpm = bpm || autoBpm || 120;
        const beatDur = 60 / currentBpm;
        const beatPhase = (t % beatDur) / beatDur;
        const pulse = Math.pow(Math.sin(beatPhase * Math.PI), 2); // Phase-locked pulse

        const count = 6;
        for (let i = 0; i < count; i++) {
          const angle = (i / count) * Math.PI * 2 + t * 0.15;
          const dist = (W * 0.15) + (pulse * W * 0.1);
          const x = cx + Math.cos(angle) * dist;
          const y = cy + Math.sin(angle) * dist;
          
          const grad = ctx.createRadialGradient(x, y, 0, x, y, W * (0.4 + pulse * 0.2));
          const alpha = (0.1 + pulse * 0.15) * E;
          grad.addColorStop(0, hexToRgba(moodColor, alpha));
          grad.addColorStop(1, "transparent");
          
          ctx.fillStyle = grad;
          ctx.fillRect(0, 0, W, H);
        }
        
        const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, W * (0.2 + pulse * 0.3));
        coreGrad.addColorStop(0, hexToRgba(moodColor, 0.03 + pulse * 0.12));
        coreGrad.addColorStop(1, "transparent");
        ctx.fillStyle = coreGrad;
        ctx.fillRect(0, 0, W, H);
      } else if (ambientStyle === "RINGS") {
        for (let ring = 0; ring < 12; ring++) {
          const baseR = 80 + ring * 70;
          const steps = 180; // Reduced steps
          ctx.beginPath();
          for (let i = 0; i <= steps; i++) {
            const a = (i / steps) * Math.PI * 2;
            const w = Math.sin(a * (2 + ring) + t * (0.5 + ring * 0.1)) * E * (60 + ring * 10);
            const rr = baseR + w;
            const x  = cx + Math.cos(a) * rr;
            const y  = cy + Math.sin(a) * rr;
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
          }
          ctx.closePath();
          ctx.strokeStyle = hexToRgba(moodColor, 0.02 + (12 - ring) * 0.008 + E * 0.06);
          ctx.lineWidth = 1 + E * 2;
          ctx.stroke();
        }
      } else if (ambientStyle === "NEBULA") {
        for (let i = 0; i < 24; i++) { // Reduced count
          const a = (i / 24) * Math.PI * 2 + t * 0.1;
          const r = (Math.sin(t * 0.5 + i) * 0.2 + 0.8) * Math.min(W, H) * 0.4;
          const x = cx + Math.cos(a) * r;
          const y = cy + Math.sin(a) * r;
          const size = (20 + Math.sin(t + i) * 10) * (1 + E * 3);
          
          const grad = ctx.createRadialGradient(x, y, 0, x, y, size);
          grad.addColorStop(0, hexToRgba(moodColor, 0.15 * E));
          grad.addColorStop(1, "transparent");
          
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(x, y, size, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (ambientStyle === "GRID") {
        const spacing = 80; // Increased spacing
        ctx.strokeStyle = hexToRgba(moodColor, 0.05 + E * 0.1);
        ctx.lineWidth = 0.5;
        
        for (let x = 0; x < W; x += spacing) {
          ctx.beginPath();
          for (let y = 0; y < H; y += 20) { // Increased step
            const dx = Math.sin(y * 0.01 + t + x * 0.01) * E * 30;
            y === 0 ? ctx.moveTo(x + dx, y) : ctx.lineTo(x + dx, y);
          }
          ctx.stroke();
        }
        for (let y = 0; y < H; y += spacing) {
          ctx.beginPath();
          for (let x = 0; x < W; x += 20) { // Increased step
            const dy = Math.sin(x * 0.01 + t + y * 0.01) * E * 30;
            x === 0 ? ctx.moveTo(x, y + dy) : ctx.lineTo(x, y + dy);
          }
          ctx.stroke();
        }
      } else if (ambientStyle === "HORIZON") {
        if (horizonParts.current.length === 0) {
          for (let i = 0; i < 100; i++) { // Reduced count
            const edge = Math.floor(Math.random() * 4);
            let x = 0, y = 0;
            if (edge === 0) { x = Math.random() * W; y = 0; }
            else if (edge === 1) { x = W; y = Math.random() * H; }
            else if (edge === 2) { x = Math.random() * W; y = H; }
            else { x = 0; y = Math.random() * H; }
            horizonParts.current.push({ x, y });
          }
        }

        ctx.fillStyle = hexToRgba(moodColor, 0.4 + E * 0.6);
        horizonParts.current.forEach(p => {
          const dx = cx - p.x;
          const dy = cy - p.y;
          const d2 = dx * dx + dy * dy; // Use squared distance
          
          const pull = (1.5 + E * 8) * 0.004;
          p.x += dx * pull;
          p.y += dy * pull;
          
          if (d2 < 25) { // 5 * 5
            const edge = Math.floor(Math.random() * 4);
            if (edge === 0) { p.x = Math.random() * W; p.y = 0; }
            else if (edge === 1) { p.x = W; p.y = Math.random() * H; }
            else if (edge === 2) { p.x = Math.random() * W; p.y = H; }
            else { p.x = 0; p.y = Math.random() * H; }
          }

          ctx.beginPath();
          ctx.arc(p.x, p.y, 1 + E * 1.5, 0, Math.PI * 2);
          ctx.fill();
        });
      }
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }, [ambient, moodColor, ambientStyle, playing]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT") return;
      if (e.code === "Space")      { e.preventDefault(); setPlaying(p => !p); }
      if (e.code === "ArrowRight") changeTrack(1);
      if (e.code === "ArrowLeft")  changeTrack(-1);
      if (e.code === "KeyM")       setMuted(m => !m);
      if (e.code === "KeyA")       setAmbient(a => !a);
      if (e.code === "Escape")     { setShortcuts(false); setAmbient(false); setShowSess(false); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [changeTrack]);

  const tapBpm = useCallback(() => {
    const now = Date.now();
    bpmTaps.current = [...bpmTaps.current.filter(t => now - t < 3500), now];
    if (bpmTaps.current.length >= 2) {
      const intervals = bpmTaps.current.slice(1).map((t, i) => t - bpmTaps.current[i]);
      setBpm(Math.round(60000 / (intervals.reduce((a, b) => a + b) / intervals.length)));
    }
  }, []);

  const filteredTracks = tracks.filter(t => 
    t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    t.sub.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const elapsed    = progress * track.dur;
  const sessTotal  = sessionMins * 60;
  const sessRatio  = sessTotal > 0 ? sessElapsed / sessTotal : 0;
  const discR      = 120;
  const arcCirc    = 2 * Math.PI * discR;

  return (
    <div 
      className="h-[100dvh] bg-black text-white selection:bg-emerald-500/30 font-mono overflow-hidden"
    >
      {/* Battery Optimization Prompt */}
      <AnimatePresence>
        {showBatteryPrompt && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[6000] flex items-center justify-center bg-black/90 p-6"
          >
            <div className="bg-black border border-white/10 p-8 rounded-2xl max-w-sm text-center">
              <h3 className="text-[10px] tracking-[0.2em] text-white/30 mb-4 uppercase">System Optimization</h3>
              <p className="text-xs text-white/60 mb-8 leading-relaxed tracking-widest uppercase">
                Exclude NEURAL_SYNC from battery optimizations to ensure uninterrupted background playback and Glyph synchronization.
              </p>
              <div className="flex flex-col gap-3">
                <motion.button 
                  whileHover={{ scale: 1.05, backgroundColor: "rgba(255,255,255,0.1)" }}
                  whileTap={{ scale: 0.95 }}
                  onClick={async () => {
                    try {
                      await (GlyphPlugin as any).requestBatteryOptimization();
                      localStorage.setItem('NEURASYNC_BATTERY_PROMPT', 'true');
                      setShowBatteryPrompt(false);
                    } catch (e) {
                      console.error("Battery optimization request failed", e);
                      setShowBatteryPrompt(false);
                    }
                  }}
                  className="w-full py-4 bg-white text-black text-[10px] font-bold tracking-[0.2em] rounded-lg uppercase"
                >
                  Exclude Now
                </motion.button>
                <motion.button 
                  whileHover={{ scale: 1.05, backgroundColor: "rgba(255,255,255,0.05)" }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setShowBatteryPrompt(false)}
                  className="w-full py-4 border border-white/10 text-[10px] text-white/40 tracking-[0.2em] rounded-lg uppercase"
                >
                  Later
                </motion.button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Notification */}
      <AnimatePresence>
        {notification && (
          <motion.div
            initial={{ opacity: 0, y: -20, x: "-50%" }}
            animate={{ opacity: 1, y: 0, x: "-50%" }}
            exit={{ opacity: 0, y: -20, x: "-50%" }}
            className="fixed top-8 left-1/2 z-[5000] bg-emerald-500 text-black px-6 py-2 rounded-full text-[10px] font-bold tracking-[0.2em] shadow-xl"
          >
            {notification}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Grid Overlay */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.03]" style={{ backgroundImage: `linear-gradient(${moodColor} 1px, transparent 1px), linear-gradient(90deg, ${moodColor} 1px, transparent 1px)`, backgroundSize: '40px 40px' }} />

      {/* Ambient Mode */}
      <AnimatePresence>
        {ambient && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[2000] bg-black ambient-lock"
          >
            <canvas ref={ambRef} className="absolute inset-0 w-full h-full" />
            <div className="absolute bottom-24 left-1/2 -translate-x-1/2 flex items-center gap-6 bg-black/60 border border-white/10 rounded-full px-10 py-5 backdrop-blur-xl">
              <div className="flex gap-2 mr-4 border-r border-white/10 pr-4">
                {(["RINGS", "NEBULA", "GRID", "HORIZON", "BREATHE"] as const).map(style => (
                  <motion.button 
                    key={style}
                    whileHover={{ scale: 1.1, backgroundColor: "rgba(255,255,255,0.15)" }}
                    whileTap={{ scale: 0.9 }}
                    onClick={() => setAmbientStyle(style)}
                    className={`text-[8px] tracking-widest px-2 py-1 rounded transition-colors ${ambientStyle === style ? 'text-white bg-white/10' : 'text-white/20 hover:text-white/40'}`}
                  >
                    {style}
                  </motion.button>
                ))}
              </div>
              <span className="text-[10px] tracking-[0.2em] text-white/40 uppercase">{track.title}</span>
              <motion.button 
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                onClick={() => setPlaying(!playing)} 
                className="w-10 h-10 rounded-full border border-white/20 flex items-center justify-center hover:border-white/40 transition-colors"
              >
                {playing ? <Pause size={16} /> : <Play size={16} className="ml-1" />}
              </motion.button>
              <motion.button 
                whileHover={{ scale: 1.05, x: 5 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => setAmbient(false)} 
                className="flex items-center gap-2 text-[10px] font-bold tracking-[0.2em] text-white hover:text-emerald-400 transition-colors bg-white/5 px-4 py-2 rounded-full border border-white/10"
              >
                <Volume2 size={14} />
                <span>CLOSE AMBIENT</span>
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <main className="relative z-10 flex items-center justify-center h-[100dvh] w-full p-2 md:p-6 overflow-hidden">
        <motion.div 
          ref={cardRef}
          initial={{ opacity: 0, y: 20, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          style={{
            borderColor: hexToRgba(moodColor, 0.15),
            boxShadow: `0 0 100px ${hexToRgba(moodColor, 0.05)}, 0 40px 100px rgba(0,0,0,0.8)`
          }}
          className="relative bg-black border rounded-3xl p-4 md:p-12 flex flex-col md:flex-row items-center md:justify-center gap-4 md:gap-12 transition-all duration-300 w-full h-full max-w-4xl max-h-[96dvh] overflow-hidden"
        >
          {/* Header Stats - 8% height approx */}
          <div className="absolute top-4 md:top-6 left-4 md:left-12 right-4 md:right-12 flex justify-between items-center z-20 h-[8%]">
            <div className="flex items-center gap-3">
              <div className={`w-1.5 h-1.5 rounded-full transition-all duration-500 ${playing ? 'bg-emerald-400 shadow-[0_0_10px_#34d399]' : 'bg-white/10'}`} />
              <span className="text-[9px] tracking-[0.2em] text-white/30 uppercase">
                {micMode ? 'MIC_INPUT' : (captureMode ? 'SYSTEM_CAPTURE' : (playing ? 'STREAMING' : 'STANDBY'))}
              </span>
            </div>
            <div className="flex gap-4">
               <motion.button 
                 whileHover={{ scale: 1.05, backgroundColor: "rgba(255,255,255,0.05)" }}
                 whileTap={{ scale: 0.95 }}
                 onClick={onLoadFolderClick}
                 className="text-[9px] text-white/20 hover:text-white transition-colors tracking-widest border border-white/10 px-2 py-1 rounded"
               >
                 {Capacitor.isNativePlatform() ? 'PICK_MUSIC' : 'LOAD_FOLDER'}
               </motion.button>
               <motion.button 
                 whileHover={{ scale: 1.1 }}
                 whileTap={{ scale: 0.9 }}
                 onClick={toggleMic} 
                 className={`transition-colors ${micMode ? 'text-emerald-400' : 'text-white/20 hover:text-white/40'}`}
               >
                 <Mic size={14} />
               </motion.button>
               <motion.button 
                 whileHover={{ scale: 1.1 }}
                 whileTap={{ scale: 0.9 }}
                 onClick={toggleCapture} 
                 className={`transition-colors ${captureMode ? 'text-emerald-400' : 'text-white/20 hover:text-white/40'}`}
               >
                 <Monitor size={14} />
               </motion.button>
               <span className="text-[9px] text-white/20 tracking-widest">
                 {String(tidx + 1).padStart(2, '0')} / {String(tracks.length).padStart(2, '0')}
               </span>
            </div>
          </div>

          {/* Left: Visualizer Disc - 40% height approx */}
          <div className="flex flex-col items-center justify-center flex-shrink-0 mt-8 md:mt-0 h-[40%]">
            <div 
              onTouchStart={startTouchDrag}
              onTouchMove={onTouchMove}
              onTouchEnd={onTouchEnd}
              className="relative w-[180px] h-[180px] sm:w-[240px] sm:h-[240px] md:w-80 md:h-80"
            >
              <motion.div 
                key={tidx}
                initial={{ scale: 0.9, opacity: 0, rotate: -10 }}
                animate={{ scale: trans ? 0.8 : 1, rotate: trans ? 180 : 0, opacity: trans ? 0 : 1 }}
                transition={{ duration: 0.5, ease: "easeInOut" }}
                className="w-full h-full rounded-full border border-white/5 bg-black overflow-hidden shadow-2xl"
              >
                <canvas ref={discRef} width={320} height={320} className="w-full h-full" />
              </motion.div>

              {/* Progress Arc */}
              <svg className="absolute inset-0 w-full h-full pointer-events-none -rotate-90" viewBox="0 0 320 320">
                <circle cx="160" cy="160" r="158" fill="none" stroke={hexToRgba(moodColor, 0.05)} strokeWidth="2" />
                <circle 
                  cx="160" cy="160" r="158" fill="none" stroke={moodColor} strokeWidth="2" 
                  strokeDasharray={2 * Math.PI * 158}
                  strokeDashoffset={2 * Math.PI * 158 * (1 - progress)}
                  className="transition-all duration-100 ease-linear"
                  style={{ filter: `drop-shadow(0 0 8px ${moodColor})` }}
                />
              </svg>
            </div>
          </div>

          {/* Right: Controls & Data - 60% height approx */}
          <div className="flex flex-col items-center text-center md:items-start md:text-left justify-center w-full md:w-80 min-h-0 md:overflow-hidden pb-8 md:pb-0 h-[60%]">
            
            {/* Static Metadata Block */}
            <div className="h-[120px] w-full flex flex-col items-center justify-center bg-black border border-white/10 rounded-2xl mb-3 md:mb-4 flex-shrink-0 overflow-hidden relative group">
               <div className="absolute inset-0 bg-gradient-to-b from-white/[0.02] to-transparent pointer-events-none" />
               <AnimatePresence mode="wait">
                 <motion.div
                   key={tidx}
                   initial={{ opacity: 0, y: 10 }}
                   animate={{ opacity: 1, y: 0 }}
                   exit={{ opacity: 0, y: -10 }}
                   transition={{ duration: 0.4, ease: "easeOut" }}
                   className="text-center px-4 w-full"
                 >
                   <div className="marquee-container mb-1">
                     <h2 
                       className="marquee-content font-dot text-white text-xl md:text-2xl font-black tracking-tighter uppercase leading-tight"
                       style={{ textShadow: `0 0 10px ${hexToRgba(moodColor, 0.5)}` }}
                     >
                       {micMode ? "MIC_ACTIVE" : (captureMode ? "EXTERNAL_INPUT" : track.title)}
                     </h2>
                   </div>
                   <div className="flex items-center justify-center gap-2 mb-2">
                     <div className="h-[1px] w-4 bg-emerald-500/50" />
                     <div className="w-1 h-1 rounded-full bg-emerald-500" />
                     <div className="h-[1px] w-4 bg-emerald-500/50" />
                   </div>
                   <p 
                     className="font-dot text-emerald-400 text-[10px] font-bold tracking-[0.3em] uppercase truncate"
                     style={{ opacity: 0.6 + energyRef.current * 0.4, textShadow: `0 0 5px ${hexToRgba(moodColor, 0.3)}` }}
                   >
                     {audioError || (micMode ? "LIVE_INPUT" : (captureMode ? "SYSTEM_CAPTURE" : track.sub))}
                   </p>
                 </motion.div>
               </AnimatePresence>
            </div>

            {/* Frequency Bars - Dedicated Container */}
            <div className="h-14 w-full bg-white/[0.02] rounded-lg overflow-hidden border border-white/5 mb-4 md:mb-6 opacity-90 flex-shrink-0">
              <canvas ref={barsRef} className="w-full h-full" />
            </div>

            {/* Mood Selector */}
            <div className="flex flex-wrap justify-center md:justify-start gap-1.5 md:gap-2 mb-3 md:mb-8 flex-shrink-0">
              {MOODS.map(m => (
                <motion.button 
                  key={m.id}
                  whileHover={{ scale: 1.05, y: -2 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setMoods(prev => ({ ...prev, [tidx]: moods[tidx] === m.id ? "" : m.id }))}
                  className={`text-[9px] px-3 py-1.5 rounded border transition-all duration-300 tracking-widest ${
                    moods[tidx] === m.id 
                      ? `bg-${m.id}/10 border-[${m.color}] text-[${m.color}]` 
                      : 'bg-transparent border-white/5 text-white/20 hover:border-white/20'
                  }`}
                  style={{ 
                    borderColor: moods[tidx] === m.id ? m.color : undefined,
                    color: moods[tidx] === m.id ? m.color : undefined,
                    backgroundColor: moods[tidx] === m.id ? hexToRgba(m.color, 0.1) : undefined
                  }}
                >
                  {m.label}
                </motion.button>
              ))}
            </div>

            {/* Visual Data */}
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="space-y-2 md:space-y-4 mb-3 md:mb-8 w-full flex-shrink-0"
            >
              <div className="h-4 md:h-8 bg-white/[0.02] rounded-lg overflow-hidden border border-white/5 opacity-60">
                <canvas ref={spectroRef} width={320} height={32} className="w-full h-full" />
              </div>
            </motion.div>

            {/* Seekbar */}
            {!captureMode && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.4 }}
                className="mb-3 md:mb-8 w-full flex-shrink-0"
              >
                <div className="flex justify-between text-[9px] text-white/20 mb-3 tracking-widest">
                  <span>{fmt(elapsed)}</span>
                  <span>{fmt(track.dur)}</span>
                </div>
                <div 
                  onClick={seek}
                  onTouchStart={touchSeek}
                  onTouchMove={touchSeek}
                  className="relative h-1 bg-white/5 rounded-full cursor-pointer group"
                >
                  <div 
                    className="absolute inset-y-0 left-0 rounded-full transition-all duration-100 ease-linear"
                    style={{ width: `${progress * 100}%`, background: moodColor, boxShadow: `0 0 10px ${moodColor}` }}
                  />
                  <div 
                    className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-xl"
                    style={{ left: `${progress * 100}%` }}
                  />
                </div>
              </motion.div>
            )}

            {/* Main Controls */}
            <div className="flex items-center justify-center gap-4 md:gap-8 mb-4 md:mb-10 flex-shrink-0">
              <motion.button 
                whileHover={{ scale: 1.2, x: -5 }}
                whileTap={{ scale: 0.8 }}
                disabled={captureMode} 
                onClick={() => changeTrack(-1)} 
                className="text-white/30 hover:text-white transition-colors disabled:opacity-10"
              >
                <SkipBack size={20} />
              </motion.button>
              
              <motion.button 
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.9 }}
                onClick={togglePlay}
                className="relative w-16 h-16 rounded-full border flex items-center justify-center transition-all duration-500 group"
                style={{ 
                  borderColor: hexToRgba(moodColor, 0.3),
                  boxShadow: playing ? `0 0 30px ${hexToRgba(moodColor, 0.2)}` : 'none'
                }}
              >
                {playing && (
                  <motion.div 
                    animate={{ scale: [1, 1.5], opacity: [0.5, 0] }}
                    transition={{ duration: 1.5, repeat: Infinity }}
                    className="absolute inset-0 rounded-full border"
                    style={{ borderColor: moodColor }}
                  />
                )}
                {playing ? <Pause size={24} /> : <Play size={24} className="ml-1" />}
              </motion.button>

              <motion.button 
                whileHover={{ scale: 1.2, x: 5 }}
                whileTap={{ scale: 0.8 }}
                disabled={captureMode} 
                onClick={() => changeTrack(1)} 
                className="text-white/30 hover:text-white transition-colors disabled:opacity-10"
              >
                <SkipForward size={20} />
              </motion.button>
            </div>

            {/* Volume & Tools */}
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.6 }}
              className="flex items-center gap-4 mb-3 md:mb-8 w-full flex-shrink-0"
            >
              <motion.button 
                whileHover={{ scale: 1.2 }}
                whileTap={{ scale: 0.8 }}
                onClick={() => setMuted(!muted)} 
                className="text-white/30"
              >
                {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
              </motion.button>
              <div 
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  setVolume(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)));
                  setMuted(false);
                }}
                className="flex-1 h-1 bg-white/5 rounded-full cursor-pointer"
              >
                <div 
                  className="h-full rounded-full transition-all duration-200"
                  style={{ width: muted ? '0%' : `${volume * 100}%`, background: hexToRgba(moodColor, 0.5) }}
                />
              </div>
            </motion.div>

            {/* Library Access */}
            <div className="mb-3 md:mb-8 w-full flex-shrink-0">
              <motion.button
                whileHover={{ scale: 1.02, backgroundColor: "rgba(255,255,255,0.05)" }}
                whileTap={{ scale: 0.98 }}
                onClick={() => setShowLibrary(true)}
                className="w-full py-3 border border-white/10 rounded-xl flex items-center justify-center gap-3 text-[10px] tracking-[0.2em] text-white/40 hover:text-white transition-all group"
              >
                <MusicIcon size={14} className="group-hover:text-emerald-400 transition-colors" />
                <span>OPEN_LIBRARY [{tracks.length}]</span>
              </motion.button>
            </div>

            {/* Footer Actions */}
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.8 }}
              className="grid grid-cols-4 gap-2"
            >
              <motion.button 
                whileHover={{ scale: 1.05, backgroundColor: "rgba(255,255,255,0.05)" }}
                whileTap={{ scale: 0.95 }}
                onClick={tapBpm} 
                className="flex flex-col items-center justify-center py-2 border border-white/5 rounded hover:border-white/20 transition-colors tracking-widest text-white/40"
              >
                <span className="text-[8px]">{bpm || autoBpm || 'TAP'}</span>
                <span className="text-[6px] opacity-50">BPM</span>
              </motion.button>
              <motion.button 
                whileHover={{ scale: 1.05, backgroundColor: "rgba(255,255,255,0.05)" }}
                whileTap={{ scale: 0.95 }}
                onClick={() => setShowSess(!showSess)} 
                className="text-[8px] py-2 border border-white/5 rounded hover:border-white/20 transition-colors tracking-widest text-white/40"
              >
                {sessionMins > 0 ? `${Math.ceil((sessTotal - sessElapsed) / 60)}M` : 'TIMER'}
              </motion.button>
              <motion.button 
                whileHover={{ scale: 1.05, backgroundColor: "rgba(255,255,255,0.05)" }}
                whileTap={{ scale: 0.95 }}
                onClick={() => setShowEq(!showEq)} 
                className={`text-[8px] py-2 border rounded transition-colors tracking-widest ${showEq ? 'border-emerald-500/50 text-emerald-400' : 'border-white/5 text-white/40 hover:border-white/20'}`}
              >
                EQ_PRO
              </motion.button>
              <motion.button 
                whileHover={{ scale: 1.05, backgroundColor: "rgba(255,255,255,0.05)" }}
                whileTap={{ scale: 0.95 }}
                onClick={() => setAmbient(!ambient)} 
                className="text-[8px] py-2 border border-white/5 rounded hover:border-white/20 transition-colors tracking-widest text-white/40"
              >
                AMBIENT
              </motion.button>
            </motion.div>
          </div>
        </motion.div>
      </main>

      {/* EQ Panel Overlay */}
      <AnimatePresence>
        {showEq && (
          <motion.div 
            initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}
            className="fixed inset-x-4 md:inset-x-auto md:right-8 top-1/2 -translate-y-1/2 z-[3000] bg-black border border-white/10 p-6 md:p-8 rounded-2xl shadow-2xl"
          >
            <div className="flex justify-between items-center mb-8">
              <div className="flex flex-col">
                <h3 className="text-[10px] tracking-[0.2em] text-white/30 uppercase">Parametric EQ</h3>
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setAutoEq(!autoEq)}
                  className={`text-[8px] mt-1 tracking-widest uppercase transition-colors ${autoEq ? 'text-emerald-400' : 'text-white/20'}`}
                >
                  Auto-EQ: {autoEq ? 'ACTIVE' : 'OFF'}
                </motion.button>
              </div>
              <motion.button 
                whileHover={{ scale: 1.2, rotate: 90 }}
                whileTap={{ scale: 0.8 }}
                onClick={() => setShowEq(false)} 
                className="text-white/20 hover:text-white"
              >
                <Maximize2 size={12} />
              </motion.button>
            </div>
            <div className="flex gap-6 h-48 items-end">
              {["60Hz", "230Hz", "910Hz", "3.6kHz", "14kHz"].map((label, i) => (
                <div key={label} className="flex flex-col items-center gap-4 h-full">
                  <div className="flex-1 w-1 bg-white/5 rounded-full relative">
                    <input 
                      type="range" min="-12" max="12" step="0.5" value={eqGains[i]}
                      onChange={(e) => updateEq(i, parseFloat(e.target.value))}
                      className="absolute inset-0 w-1 h-full opacity-0 cursor-pointer z-10"
                      style={{ writingMode: 'vertical-lr', direction: 'rtl' } as any}
                    />
                    <motion.div 
                      className="absolute bottom-0 left-0 w-full rounded-full"
                      style={{ 
                        height: `${((eqGains[i] + 12) / 24) * 100}%`, 
                        background: moodColor,
                        boxShadow: `0 0 10px ${hexToRgba(moodColor, 0.5)}`
                      }}
                    />
                  </div>
                  <span className="text-[8px] text-white/20 rotate-45 mt-2">{label}</span>
                  <span className="text-[8px] text-white/40">{eqGains[i] > 0 ? '+' : ''}{eqGains[i]}dB</span>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Session Selector Overlay */}
      <AnimatePresence>
        {showSess && (
          <motion.div 
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}
            className="fixed inset-0 z-[3000] flex items-center justify-center bg-black/90"
            onClick={() => setShowSess(false)}
          >
            <div className="bg-black border border-white/10 p-8 rounded-2xl w-64" onClick={e => e.stopPropagation()}>
              <h3 className="text-[10px] tracking-[0.2em] text-white/30 mb-6 uppercase">Session Timer</h3>
              <div className="grid grid-cols-2 gap-2">
                {[5, 10, 20, 30, 45, 60].map(min => (
                  <motion.button 
                    key={min}
                    whileHover={{ scale: 1.05, backgroundColor: "rgba(255,255,255,0.05)" }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => { setSessionMins(min); setSessElapsed(0); setShowSess(false); }}
                    className="text-[10px] py-3 border border-white/5 rounded-lg hover:bg-white/5 transition-colors"
                  >
                    {min} MIN
                  </motion.button>
                ))}
              </div>
              {sessionMins > 0 && (
                <motion.button 
                  whileHover={{ scale: 1.02, color: "#f87171" }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => { setSessionMins(0); setShowSess(false); }} 
                  className="w-full mt-4 text-[9px] py-2 text-red-400/60 hover:text-red-400 transition-colors"
                >
                  CANCEL TIMER
                </motion.button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Library Overlay */}
      <AnimatePresence>
        {showLibrary && (
          <motion.div 
            initial={{ opacity: 0, scale: 1.1 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.1 }}
            className="fixed inset-0 z-[4000] bg-black p-6 md:p-12 flex flex-col"
          >
            <div className="flex justify-between items-center mb-8">
              <div className="flex items-center gap-4">
                <MusicIcon size={24} className="text-emerald-400" />
                <div>
                  <h2 className="text-xl font-black tracking-tighter uppercase">Music Registry</h2>
                  <p className="text-[10px] text-white/30 tracking-widest uppercase">{tracks.length} Tracks Indexed</p>
                </div>
              </div>
              <motion.button
                whileHover={{ rotate: 90, scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                onClick={() => setShowLibrary(false)}
                className="w-12 h-12 rounded-full border border-white/10 flex items-center justify-center text-white/40 hover:text-white hover:border-white/30 transition-all"
              >
                <X size={20} />
              </motion.button>
            </div>

            <div className="relative mb-8">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-white/20" size={16} />
              <input 
                type="text"
                placeholder="SEARCH_REGISTRY..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-white/[0.03] border border-white/10 rounded-xl py-4 pl-12 pr-4 text-sm tracking-widest focus:outline-none focus:border-emerald-500/50 transition-colors uppercase font-mono"
              />
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar pr-4 space-y-2">
              {filteredTracks.map((t, i) => {
                const originalIndex = tracks.indexOf(t);
                const isActive = originalIndex === tidx;
                return (
                  <motion.div
                    key={originalIndex}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.02 }}
                    className={`group flex items-center justify-between p-4 rounded-xl border transition-all ${isActive ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-white/[0.02] border-white/5 hover:border-white/20'}`}
                  >
                    <div 
                      className="flex-1 flex items-center gap-6 cursor-pointer"
                      onClick={() => { setTidx(originalIndex); setPlaying(true); setShowLibrary(false); }}
                    >
                      <span className={`text-xs font-mono w-8 ${isActive ? 'text-emerald-400' : 'text-white/10'}`}>
                        {String(originalIndex + 1).padStart(2, '0')}
                      </span>
                      <div className="flex flex-col">
                        <span className={`text-sm font-bold tracking-wider ${isActive ? 'text-white' : 'text-white/60'}`}>{t.title}</span>
                        <span className="text-[9px] text-white/20 tracking-widest uppercase">{t.sub}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      {isActive && playing && (
                        <div className="flex gap-1 items-end h-3">
                          {[0, 1, 2, 3].map(b => (
                            <motion.div
                              key={b}
                              animate={{ height: [4, 12, 6, 16, 4] }}
                              transition={{ duration: 0.5 + b * 0.1, repeat: Infinity }}
                              className="w-1 bg-emerald-400"
                            />
                          ))}
                        </div>
                      )}
                      <motion.button
                        whileHover={{ scale: 1.2, color: "#f87171" }}
                        whileTap={{ scale: 0.8 }}
                        onClick={(e) => { e.stopPropagation(); deleteTrack(originalIndex); }}
                        className="text-white/10 hover:text-red-400 transition-colors p-2"
                      >
                        <Trash2 size={16} />
                      </motion.button>
                    </div>
                  </motion.div>
                );
              })}
              {filteredTracks.length === 0 && (
                <div className="h-64 flex flex-col items-center justify-center text-white/10 gap-4">
                  <Search size={48} />
                  <p className="text-xs tracking-[0.3em] uppercase">No Matches Found</p>
                </div>
              )}
            </div>

            <div className="mt-8 pt-8 border-t border-white/5 flex justify-between items-center">
              <p className="text-[10px] text-white/20 tracking-widest uppercase">Registry Sync: Active</p>
              <motion.button
                whileHover={{ scale: 1.05, backgroundColor: "rgba(255,255,255,0.05)" }}
                whileTap={{ scale: 0.95 }}
                onClick={onLoadFolderClick}
                className="px-6 py-3 border border-white/10 rounded-lg text-[10px] tracking-widest uppercase hover:text-emerald-400 transition-colors"
              >
                Add New Files
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <audio 
        ref={audioRef} 
        crossOrigin="anonymous" 
        onError={handleAudioError}
      />

      <input 
        type="file"
        ref={fileInputRef}
        className="hidden"
        onChange={handleFolderSelect}
        {...({ webkitdirectory: "", directory: "", multiple: true } as any)}
      />
      
      <style>{`
        @keyframes pulse {
          0% { transform: scale(1); opacity: 0.5; }
          100% { transform: scale(1.5); opacity: 0; }
        }
        .custom-scrollbar::-webkit-scrollbar {
          width: 2px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(255, 255, 255, 0.02);
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.2);
        }
      `}</style>
    </div>
  );
}
