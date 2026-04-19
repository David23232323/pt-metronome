import React, { useState, useEffect, useRef, useCallback } from 'react';
import './App.css';

// Audio engine constants
const CLICK_FREQUENCY = 1000;
const CLICK_DURATION = 0.05;

function App() {
  // Metronome State
  const [bpm, setBpm] = useState(120);
  const [isPlaying, setIsPlaying] = useState(false);
  
  // Timer State
  const [timerEnabled, setTimerEnabled] = useState(false);
  const [timerMinutes, setTimerMinutes] = useState(1);
  const [timeLeft, setTimeLeft] = useState(60);

  // Word Reader State
  const [words, setWords] = useState<string[]>(['A', 'B', 'C', 'D']);
  const [wordInput, setWordInput] = useState('A, B, C, D');
  const [readFrequency, setReadFrequency] = useState(4);
  const [readVariance, setReadVariance] = useState(1.5);
  const [readerEnabled, setReaderEnabled] = useState(false);
  const [readMode, setReadMode] = useState<'random' | 'sequential'>('random');
  const [currentIndex, setCurrentIndex] = useState(0);

  // Refs for audio and timing
  const audioCtxRef = useRef<AudioContext | null>(null);
  const nextClickTimeRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const nextSpeechTimeRef = useRef(0);
  const lastWordRef = useRef<string>('');

  // Initialize Audio Context
  const initAudio = useCallback(() => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }
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
      setTimeLeft(timerMinutes * 60);
    }
  }, [timerMinutes, isPlaying]);

  // Metronome & Reader Scheduler
  const scheduler = useCallback(() => {
    if (!audioCtxRef.current) return;

    while (nextClickTimeRef.current < audioCtxRef.current.currentTime + 0.1) {
      const osc = audioCtxRef.current.createOscillator();
      const envelope = audioCtxRef.current.createGain();

      osc.frequency.value = CLICK_FREQUENCY;
      envelope.gain.value = 1;
      envelope.gain.exponentialRampToValueAtTime(1, nextClickTimeRef.current);
      envelope.gain.exponentialRampToValueAtTime(0.001, nextClickTimeRef.current + CLICK_DURATION);

      osc.connect(envelope);
      envelope.connect(audioCtxRef.current.destination);

      osc.start(nextClickTimeRef.current);
      osc.stop(nextClickTimeRef.current + CLICK_DURATION);

      nextClickTimeRef.current += 60.0 / bpm;
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

      const variance = readMode === 'random' ? (Math.random() * 2 - 1) * readVariance : 0;
      const nextInterval = Math.max(0.5, readFrequency + variance);
      nextSpeechTimeRef.current = audioCtxRef.current.currentTime + nextInterval;
    }

    timerRef.current = requestAnimationFrame(scheduler);
  }, [bpm, words, readerEnabled, readFrequency, readVariance, readMode, currentIndex]);

  useEffect(() => {
    if (isPlaying) {
      nextClickTimeRef.current = audioCtxRef.current!.currentTime;
      nextSpeechTimeRef.current = audioCtxRef.current!.currentTime + readFrequency;
      if (readMode === 'sequential') setCurrentIndex(0);
      lastWordRef.current = '';
      timerRef.current = requestAnimationFrame(scheduler);
    } else {
      if (timerRef.current) cancelAnimationFrame(timerRef.current);
    }
    return () => {
      if (timerRef.current) cancelAnimationFrame(timerRef.current);
    };
  }, [isPlaying, scheduler, readFrequency, readMode]);

  const handleToggle = () => {
    if (!isPlaying) {
      initAudio();
      // Unlock speech synthesis on mobile with a silent utterance
      const dummy = new SpeechSynthesisUtterance("");
      dummy.volume = 0;
      window.speechSynthesis.speak(dummy);
    }
    setIsPlaying(!isPlaying);
  };

  const handleWordInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setWordInput(e.target.value);
    const newWords = e.target.value.split(',').map(w => w.trim()).filter(w => w !== '');
    setWords(newWords);
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
            <input 
              type="number" 
              step="1"
              inputMode="numeric"
              value={timerMinutes} 
              onChange={(e) => setTimerMinutes(Math.max(1, parseInt(e.target.value) || 1))}
              disabled={isPlaying}
            />
            <span>min</span>
            <div className="time-left">{formatTime(timeLeft)}</div>
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
            <label>Words (comma separated)</label>
            <textarea 
              value={wordInput} 
              onChange={handleWordInputChange}
              placeholder="A, B, C, D"
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
                value={readFrequency} 
                onChange={(e) => setReadFrequency(Math.max(0.5, parseFloat(e.target.value) || 0.5))}
              />
            </div>
            <div className={`input-group ${readMode !== 'random' ? 'hidden-opacity' : ''}`}>
              <label>Variance (±s)</label>
              <input 
                type="number" 
                step="0.1"
                inputMode="decimal"
                value={readVariance} 
                onChange={(e) => setReadVariance(Math.max(0, parseFloat(e.target.value) || 0))}
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
