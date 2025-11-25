import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Mic, MicOff, AlertCircle, Volume2 } from 'lucide-react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { createPcmBlob, decode, decodeAudioData, INPUT_SAMPLE_RATE } from '../utils/audioUtils';
import VoiceVisualizer from './VoiceVisualizer';
import { ConnectionState } from '../types';

interface LiveModeProps {
  apiKey: string;
}

const LiveMode: React.FC<LiveModeProps> = ({ apiKey }) => {
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.DISCONNECTED);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [volume, setVolume] = useState(0);

  // Audio References
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const outputAnalyserRef = useRef<AnalyserNode | null>(null);
  
  // Playback Queue
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  // Connection Ref
  const sessionPromiseRef = useRef<Promise<any> | null>(null);

  const cleanupAudio = useCallback(() => {
    // Stop all playing sources
    sourcesRef.current.forEach(source => {
        try { source.stop(); } catch (e) {}
    });
    sourcesRef.current.clear();

    // Close microphone stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    // Disconnect processor
    if (processorRef.current) {
        processorRef.current.disconnect();
        processorRef.current = null;
    }
    if (sourceRef.current) {
        sourceRef.current.disconnect();
        sourceRef.current = null;
    }

    // Close contexts (optional, but good for cleanup)
    if (inputAudioContextRef.current) {
        inputAudioContextRef.current.close();
        inputAudioContextRef.current = null;
    }
    if (outputAudioContextRef.current) {
        outputAudioContextRef.current.close();
        outputAudioContextRef.current = null;
    }

    nextStartTimeRef.current = 0;
  }, []);

  const connectToLive = async () => {
    setConnectionState(ConnectionState.CONNECTING);
    setErrorMsg(null);

    try {
        // 1. Initialize Audio Contexts
        const InputContextClass = window.AudioContext || (window as any).webkitAudioContext;
        const inputCtx = new InputContextClass({ sampleRate: INPUT_SAMPLE_RATE });
        const outputCtx = new InputContextClass({ sampleRate: 24000 }); // Output usually 24k

        inputAudioContextRef.current = inputCtx;
        outputAudioContextRef.current = outputCtx;

        // Setup Analyser for Visualizer (Output)
        const analyser = outputCtx.createAnalyser();
        analyser.fftSize = 256;
        analyser.connect(outputCtx.destination); // Connect analyser to speakers
        outputAnalyserRef.current = analyser;

        // 2. Get User Media
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = stream;

        // 3. Initialize Gemini
        const ai = new GoogleGenAI({ apiKey });
        
        // 4. Setup Connection
        const sessionPromise = ai.live.connect({
            model: 'gemini-2.5-flash-native-audio-preview-09-2025',
            config: {
                responseModalities: [Modality.AUDIO],
                speechConfig: {
                    voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } },
                },
                systemInstruction: "You are a helpful, witty, and concise personal AI assistant. Keep responses relatively short and conversational.",
            },
            callbacks: {
                onopen: () => {
                    setConnectionState(ConnectionState.CONNECTED);
                    
                    // Setup Audio Input Processing
                    const source = inputCtx.createMediaStreamSource(stream);
                    const processor = inputCtx.createScriptProcessor(4096, 1, 1);
                    
                    processor.onaudioprocess = (e) => {
                        const inputData = e.inputBuffer.getChannelData(0);
                        const pcmBlob = createPcmBlob(inputData);
                        
                        // Send to Gemini
                        sessionPromise.then((session) => {
                            session.sendRealtimeInput({ media: pcmBlob });
                        });
                        
                        // Simple volume meter for input (optional visual feedback)
                        let sum = 0;
                        for(let i=0; i<inputData.length; i++) sum += inputData[i] * inputData[i];
                        const rms = Math.sqrt(sum / inputData.length);
                        setVolume(Math.min(1, rms * 5)); 
                    };

                    source.connect(processor);
                    processor.connect(inputCtx.destination); // Required for script processor to run
                    
                    sourceRef.current = source;
                    processorRef.current = processor;
                },
                onmessage: async (message: LiveServerMessage) => {
                    // Handle Audio Output
                    const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
                    
                    if (base64Audio && outputAudioContextRef.current) {
                        const ctx = outputAudioContextRef.current;
                        
                        // Ensure time is monotonic
                        nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);

                        const audioBuffer = await decodeAudioData(
                            decode(base64Audio),
                            ctx,
                            24000,
                            1
                        );

                        const source = ctx.createBufferSource();
                        source.buffer = audioBuffer;
                        
                        // Connect to analyser -> destination
                        if (outputAnalyserRef.current) {
                            source.connect(outputAnalyserRef.current);
                        } else {
                            source.connect(ctx.destination);
                        }

                        source.addEventListener('ended', () => {
                            sourcesRef.current.delete(source);
                        });

                        source.start(nextStartTimeRef.current);
                        nextStartTimeRef.current += audioBuffer.duration;
                        sourcesRef.current.add(source);
                    }

                    // Handle Interruption
                    if (message.serverContent?.interrupted) {
                        sourcesRef.current.forEach(src => {
                            try { src.stop(); } catch(e){}
                        });
                        sourcesRef.current.clear();
                        nextStartTimeRef.current = 0;
                    }
                },
                onclose: () => {
                    setConnectionState(ConnectionState.DISCONNECTED);
                    cleanupAudio();
                },
                onerror: (err) => {
                    console.error("Live API Error:", err);
                    setConnectionState(ConnectionState.ERROR);
                    setErrorMsg("Connection error occurred.");
                    cleanupAudio();
                }
            }
        });

        sessionPromiseRef.current = sessionPromise;

    } catch (err) {
        console.error("Setup Error:", err);
        setConnectionState(ConnectionState.ERROR);
        setErrorMsg("Failed to access microphone or connect to API.");
        cleanupAudio();
    }
  };

  const disconnectFromLive = () => {
    // There isn't a direct "disconnect" method exposed easily in the basic promise return
    // but typically we close by cleaning up client side. 
    // Ideally, we'd call session.close() if exposed, but wrapping the logic:
    if (sessionPromiseRef.current) {
        // Currently the SDK doesn't export a clean close on the promise result easily 
        // without keeping the session object.
        // We will force cleanup locally.
    }
    cleanupAudio();
    setConnectionState(ConnectionState.DISCONNECTED);
    // Refresh the page or hard reset state if needed, but local cleanup usually stops the flow.
  };

  useEffect(() => {
    return () => {
        cleanupAudio();
    };
  }, [cleanupAudio]);


  const isConnected = connectionState === ConnectionState.CONNECTED;

  return (
    <div className="flex flex-col h-full bg-slate-900 rounded-xl overflow-hidden shadow-2xl border border-slate-800 relative p-6 items-center justify-center space-y-8">
      
      {/* Visualizer Area */}
      <div className="relative w-full max-w-2xl h-64 bg-slate-950 rounded-2xl border border-slate-800 overflow-hidden shadow-inner flex items-center justify-center">
        {connectionState === ConnectionState.ERROR ? (
            <div className="text-red-400 flex flex-col items-center gap-2">
                <AlertCircle className="w-10 h-10" />
                <p>{errorMsg}</p>
            </div>
        ) : (
            <>
                <VoiceVisualizer 
                    analyser={outputAnalyserRef.current} 
                    isActive={isConnected}
                    accentColor="#818cf8"
                />
                 {/* Overlay status text */}
                <div className="absolute top-4 left-4 flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-slate-700'}`}></div>
                    <span className="text-xs uppercase tracking-widest text-slate-500 font-semibold">
                        {connectionState === ConnectionState.CONNECTING ? 'Connecting...' : 
                         connectionState === ConnectionState.CONNECTED ? 'Live Session' : 'Ready'}
                    </span>
                </div>
            </>
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-6">
        <button
            onClick={isConnected ? disconnectFromLive : connectToLive}
            className={`
                group relative flex items-center justify-center w-24 h-24 rounded-full transition-all duration-300
                ${isConnected 
                    ? 'bg-red-500/10 hover:bg-red-500/20 border-red-500 text-red-500' 
                    : 'bg-indigo-600 hover:bg-indigo-500 border-indigo-400 text-white shadow-lg shadow-indigo-500/50'}
                border-2
            `}
        >
            {connectionState === ConnectionState.CONNECTING ? (
                <div className="w-8 h-8 border-4 border-current border-t-transparent rounded-full animate-spin"></div>
            ) : isConnected ? (
                <MicOff className="w-8 h-8" />
            ) : (
                <Mic className="w-8 h-8" />
            )}
            
            {/* Ripple effect when active */}
            {isConnected && (
                <span className="absolute inset-0 rounded-full animate-ping bg-red-500/20"></span>
            )}
        </button>
      </div>

      <div className="text-center space-y-2 max-w-md">
        <h3 className="text-xl font-bold text-white">
            {isConnected ? "Listening..." : "Start Live Conversation"}
        </h3>
        <p className="text-slate-400 text-sm">
            {isConnected 
                ? "Speak naturally. The agent is listening and will respond in real-time." 
                : "Experience low-latency, real-time voice interaction powered by Gemini 2.5."}
        </p>
      </div>
      
      {/* Input Level Indicator (Subtle) */}
      {isConnected && (
         <div className="flex items-center gap-2 text-slate-600 text-xs">
            <Volume2 className="w-4 h-4" />
            <div className="w-32 h-1 bg-slate-800 rounded-full overflow-hidden">
                <div className="h-full bg-indigo-500 transition-all duration-75" style={{ width: `${volume * 100}%` }}></div>
            </div>
         </div>
      )}

    </div>
  );
};

export default LiveMode;
