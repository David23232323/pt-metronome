import React, { useState, useEffect, useRef, useCallback } from 'react';
import './App.css';

// Audio engine constants
const CLICK_FREQUENCY = 1000;
const CLICK_DURATION = 0.05;

// Stores the raw string while typing, validates and clamps on blur
function useNumericInput(
  initial: number,
  opts: { min?: number; max?: number; integer?: boolean } = {}
) {
  const [display, setDisplay] = useState(String(initial));
  const parseFn = opts.integer ? parseInt : parseFloat;

  const parsed = parseFn(display);
  const value = isNaN(parsed)
    ? initial
    : Math.min(opts.max ?? Infinity, Math.max(opts.min ?? -Infinity, parsed));

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setDisplay(e.target.value);
  };
  const onBlur = () => setDisplay(String(value));
  const set = (n: number) => setDisplay(String(n));

  return { value, display, onChange, onBlur, set };
}

function App() {
  // Metronome State
  const [bpm, setBpm] = useState(120);
  const [isPlaying, setIsPlaying] = useState(false);
  
  // Timer State
  const [timerEnabled, setTimerEnabled] = useState(false);
  const timerMin = useNumericInput(1, { min: 0, integer: true });
  const timerSec = useNumericInput(0, { min: 0, max: 59, integer: true });
  const [timeLeft, setTimeLeft] = useState(60);

  // Word Reader State
  const [words, setWords] = useState<string[]>(['A', 'B', 'C', 'D']);
  const [wordInput, setWordInput] = useState('A B C D');
  const frequency = useNumericInput(4, { min: 0.5 });
  const variance = useNumericInput(1.5, { min: 0 });
  const [readerEnabled, setReaderEnabled] = useState(false);
  const [readMode, setReadMode] = useState<'random' | 'sequential'>('random');
  const [currentIndex, setCurrentIndex] = useState(0);

  // Refs for audio and timing
  const audioCtxRef = useRef<AudioContext | null>(null);
  const clickBufferRef = useRef<AudioBuffer | null>(null);
  const nextClickTimeRef = useRef(0);
  const intervalIdRef = useRef<number | null>(null);
  const nextSpeechTimeRef = useRef(0);
  const lastWordRef = useRef<string>('');
  const schedulerFnRef = useRef<() => void>(() => {});

  const initAudio = useCallback(() => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();

      // Pre-render the click sound into a reusable buffer
      const sr = audioCtxRef.current.sampleRate;
      const len = Math.ceil(CLICK_DURATION * sr);
      const buf = audioCtxRef.current.createBuffer(1, len, sr);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        const envelope = Math.exp(-t * (Math.log(1000) / CLICK_DURATION));
        data[i] = Math.sin(2 * Math.PI * CLICK_FREQUENCY * t) * envelope;
      }
      clickBufferRef.current = buf;
    }

    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }

    // Bypass iOS silent mode: set audio session to "playback" so audio
    // plays even when the device mute switch is on (Safari 17.4+)
    if ('audioSession' in navigator) {
      (navigator as any).audioSession.type = 'playback';
    }

    // Play a short silent buffer to fully activate the context on iOS
    const warmUp = audioCtxRef.current.createBuffer(1, 1, audioCtxRef.current.sampleRate);
    const src = audioCtxRef.current.createBufferSource();
    src.buffer = warmUp;
    src.connect(audioCtxRef.current.destination);
    src.start();

    return audioCtxRef.current;
  }, []);

  // Resume AudioContext when returning from lock screen / background tab
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && audioCtxRef.current?.state === 'suspended') {
        audioCtxRef.current.resume();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  // Timer logic
  useEffect(() => {
    let interval: number;
    if (isPlaying && timerEnabled && timeLeft > 0) {
      interval = window.setInterval(() => {
        setTimeLeft(prev => {
          if (prev <= 1) {
            setIsPlaying(false);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isPlaying, timerEnabled, timeLeft]);

  useEffect(() => {
    if (!isPlaying) {
      setTimeLeft(timerMin.value * 60 + timerSec.value);
    }
  }, [timerMin.value, timerSec.value, isPlaying]);

  // Metronome & Reader Scheduler
  const scheduler = useCallback(() => {
    if (!audioCtxRef.current || !clickBufferRef.current) return;

    const beatInterval = 60.0 / bpm;
    const now = audioCtxRef.current.currentTime;

    // If clicks have fallen far behind (e.g. tab was backgrounded),
    // jump forward rather than scheduling a burst of catch-up clicks
    if (nextClickTimeRef.current < now - beatInterval) {
      const missed = Math.ceil((now - nextClickTimeRef.current) / beatInterval);
      nextClickTimeRef.current += missed * beatInterval;
    }

    // Schedule clicks well ahead of time — the Web Audio API handles
    // precise playback, we just need to keep the queue fed
    while (nextClickTimeRef.current < now + 0.5) {
      const playTime = Math.max(nextClickTimeRef.current, now);
      const src = audioCtxRef.current.createBufferSource();
      src.buffer = clickBufferRef.current;
      src.connect(audioCtxRef.current.destination);
      src.start(playTime);

      nextClickTimeRef.current += beatInterval;
    }

    // Word Reader Scheduling
    if (readerEnabled && nextSpeechTimeRef.current < audioCtxRef.current.currentTime) {
      let selectedWord = '';
      if (readMode === 'random') {
        if (words.length > 1) {
          let newWord = '';
          do {
            newWord = words[Math.floor(Math.random() * words.length)];
          } while (newWord === lastWordRef.current);
          selectedWord = newWord;
        } else {
          selectedWord = words[0] || '';
        }
      } else {
        selectedWord = words[currentIndex % words.length] || '';
        setCurrentIndex(prev => (prev + 1) % words.length);
      }

      if (selectedWord) {
        lastWordRef.current = selectedWord;
        const utterance = new SpeechSynthesisUtterance(selectedWord.toLowerCase());
        window.speechSynthesis.speak(utterance);
      }

      const readVariance = readMode === 'random' ? (Math.random() * 2 - 1) * variance.value : 0;
      const nextInterval = Math.max(0.5, frequency.value + readVariance);
      nextSpeechTimeRef.current = audioCtxRef.current.currentTime + nextInterval;
    }
  }, [bpm, words, readerEnabled, frequency.value, variance.value, readMode, currentIndex]);

  // Keep the ref always pointing at the latest scheduler closure
  schedulerFnRef.current = scheduler;

  // Start/stop the interval — only depends on isPlaying so the
  // interval is never torn down and recreated during playback
  useEffect(() => {
    if (isPlaying && audioCtxRef.current) {
      nextClickTimeRef.current = audioCtxRef.current.currentTime + 0.05;
      nextSpeechTimeRef.current = audioCtxRef.current.currentTime + frequency.value;
      if (readMode === 'sequential') setCurrentIndex(0);
      lastWordRef.current = '';
      intervalIdRef.current = window.setInterval(() => schedulerFnRef.current(), 25);
    } else {
      if (intervalIdRef.current) clearInterval(intervalIdRef.current);
    }
    return () => {
      if (intervalIdRef.current) clearInterval(intervalIdRef.current);
    };
  }, [isPlaying]);

  const handleToggle = () => {
    if (!isPlaying) {
      initAudio();

      // Unlock speech synthesis on iOS
      const dummy = new SpeechSynthesisUtterance("");
      dummy.volume = 0;
      window.speechSynthesis.speak(dummy);
    }
    setIsPlaying(!isPlaying);
  };

  const handleWordInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setWordInput(e.target.value);
    const newWords = e.target.value.split(/\s+/).filter(w => w !== '');
    setWords(newWords);
  };

  const handlePresetClick = (m: number) => {
    timerMin.set(m);
    timerSec.set(0);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="container">
      <h1>PT-Metronome</h1>
      
      <div className="section metronome-controls">
        <div className="bpm-display">
          <span className="bpm-value">{bpm}</span>
          <span className="bpm-label">BPM</span>
        </div>
        <input 
          type="range" 
          min="40" 
          max="240" 
          value={bpm} 
          onChange={(e) => setBpm(parseInt(e.target.value))}
          className="slider"
        />
        <button className={`play-button ${isPlaying ? 'stop' : 'start'}`} onClick={handleToggle}>
          {isPlaying ? 'STOP' : 'START'}
        </button>
      </div>

      <div className="section timer-section">
        <label className="checkbox-label">
          <input 
            type="checkbox" 
            checked={timerEnabled} 
            onChange={(e) => setTimerEnabled(e.target.checked)} 
          />
          Enable Timer
        </label>
        {timerEnabled && (
          <div className="timer-controls">
            <div className="preset-buttons">
              {[1, 3, 5, 10].map(m => (
                <button 
                  key={m} 
                  className={`preset-btn ${timerMin.value === m && timerSec.value === 0 ? 'active' : ''}`}
                  onClick={() => handlePresetClick(m)}
                  disabled={isPlaying}
                >
                  {m}m
                </button>
              ))}
            </div>
            <div className="manual-timer">
              <div className="input-with-label">
                <input 
                  type="number" 
                  step="1"
                  inputMode="numeric"
                  value={timerMin.display} 
                  onChange={timerMin.onChange}
                  onBlur={timerMin.onBlur}
                  disabled={isPlaying}
                />
                <label>min</label>
              </div>
              <span className="separator">:</span>
              <div className="input-with-label">
                <input 
                  type="number" 
                  step="1"
                  min="0"
                  max="59"
                  inputMode="numeric"
                  value={timerSec.display} 
                  onChange={timerSec.onChange}
                  onBlur={timerSec.onBlur}
                  disabled={isPlaying}
                />
                <label>sec</label>
              </div>
            </div>
            <div className="time-left-display">
              <span className="label">Remaining:</span>
              <span className="time">{formatTime(timeLeft)}</span>
            </div>
          </div>
        )}
      </div>

      <div className="section reader-section">
        <div className="reader-header">
          <label className="checkbox-label">
            <input 
              type="checkbox" 
              checked={readerEnabled} 
              onChange={(e) => setReaderEnabled(e.target.checked)} 
            />
            Enable Word Reader
          </label>
          <p className="description">
            Reads words or letters aloud at specific intervals.
          </p>
        </div>
        
        <div className="reader-inputs">
          <div className="input-group">
            <label>Words (space separated)</label>
            <textarea 
              value={wordInput} 
              onChange={handleWordInputChange}
              placeholder="A B C D"
            />
          </div>
          
          <div className="input-row">
            <div className="input-group">
              <label>Order</label>
              <select 
                value={readMode} 
                onChange={(e) => setReadMode(e.target.value as 'random' | 'sequential')}
                className="select-input"
              >
                <option value="random">Randomly</option>
                <option value="sequential">In Order</option>
              </select>
            </div>
            <div className="input-group">
              <label>Frequency (s)</label>
              <input 
                type="number" 
                step="0.5"
                inputMode="decimal"
                value={frequency.display} 
                onChange={frequency.onChange}
                onBlur={frequency.onBlur}
              />
            </div>
            <div className={`input-group ${readMode !== 'random' ? 'hidden-opacity' : ''}`}>
              <label>Variance (±s)</label>
              <input 
                type="number" 
                step="0.1"
                inputMode="decimal"
                value={variance.display} 
                onChange={variance.onChange}
                onBlur={variance.onBlur}
                disabled={readMode !== 'random'}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
