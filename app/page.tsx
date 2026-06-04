'use client';

import { useState, useEffect, useRef } from 'react';
import { runMonteCarlo, SimResults } from '@/utils/monteCarlo';

interface MomentumMetrics {
  currentPrice: number;
  skewScore: number;
  bullBumperHits: number;
  bearBumperHits: number;
  tickCount: number;
  dynamicVolatility: number;
}

export default function SteampunkDashboard() {
  const [symbol, setSymbol] = useState('ethusdt');
  const [isStreaming, setIsStreaming] = useState(false);
  const [metrics, setMetrics] = useState<MomentumMetrics | null>(null);
  const [secondsElapsed, setSecondsElapsed] = useState(0);

  // Simulation Parameters
  const [days, setDays] = useState(15);
  const [iterations, setIterations] = useState(400);

  // Price memory for the monochrome graph canvas (stores last 100 prices)
  const [graphPrices, setGraphPrices] = useState<number[]>([]);

  const paramsRef = useRef({ days, iterations });
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    paramsRef.current = { days, iterations };
  }, [days, iterations]);

  // 1. Session Timer
  useEffect(() => {
    let timerId: NodeJS.Timeout;
    if (isStreaming) {
      setSecondsElapsed(0);
      setGraphPrices([]); // Clear old ink trail on restart
      timerId = setInterval(() => {
        setSecondsElapsed((prev) => prev + 1);
      }, 1000);
    } else {
      setSecondsElapsed(0);
    }
    return () => {
      if (timerId) clearInterval(timerId);
    };
  }, [isStreaming]);

  // 2. High-Frequency WebSocket Thread
  useEffect(() => {
    if (!isStreaming) {
      setMetrics(null);
      return;
    }

    let totalTicks = 0;
    let cumulativeBullHits = 0;
    let cumulativeBearHits = 0;
    let anchorPrice = 0;

    const priceHistory: number[] = [];
    const maxLookback = 50;
    let rollingVol = 0.50;

    const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${symbol}@aggTrade`);

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      const currentPrice = parseFloat(data.p);
      totalTicks++;

      // Track price nodes for the canvas chart (throttle updates slightly for performance)
      if (totalTicks % 2 === 0) {
        setGraphPrices((prev) => {
          const updated = [...prev, currentPrice];
          return updated.length > 120 ? updated.slice(1) : updated;
        });
      }

      priceHistory.push(currentPrice);
      if (priceHistory.length > maxLookback) priceHistory.shift();

      if (priceHistory.length >= 5) {
        const logReturns: number[] = [];
        for (let i = 1; i < priceHistory.length; i++) {
          logReturns.push(Math.log(priceHistory[i] / priceHistory[i - 1]));
        }
        const meanReturn = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
        const squaredDiffs = logReturns.map(r => Math.pow(r - meanReturn, 2));
        const variance = squaredDiffs.reduce((a, b) => a + b, 0) / (logReturns.length - 1 || 1);
        const tickDeviation = Math.sqrt(variance);
        const annualizationScaler = Math.sqrt(63072000);
        const computedVol = tickDeviation * annualizationScaler;

        rollingVol = (rollingVol * 0.9) + (computedVol * 0.1);
        rollingVol = Math.max(0.10, Math.min(1.50, rollingVol));
      }

      const currentParams = paramsRef.current;
      if (totalTicks === 1 || anchorPrice === 0) anchorPrice = currentPrice;

      const simResults: SimResults = runMonteCarlo(
          currentPrice,
          currentParams.days,
          currentParams.iterations,
          0.02,
          rollingVol
      );

      const finalPrices = simResults.paths.map(path => path[path.length - 1]);
      const upperBumper = anchorPrice * (1 + (rollingVol * 0.005));
      const lowerBumper = anchorPrice * (1 - (rollingVol * 0.005));

      let pathsAboveUpper = 0;
      let pathsBelowLower = 0;

      finalPrices.forEach(price => {
        if (price > upperBumper) pathsAboveUpper++;
        if (price < lowerBumper) pathsBelowLower++;
      });

      if (pathsAboveUpper > currentParams.iterations * 0.6) cumulativeBullHits++;
      if (pathsBelowLower > currentParams.iterations * 0.6) cumulativeBearHits++;

      const pathsAboveCurrent = finalPrices.filter(p => p > currentPrice).length;
      const rawRatio = pathsAboveCurrent / currentParams.iterations;
      const skewScore = Math.round((rawRatio - 0.5) * 200);

      if (totalTicks % 100 === 0) anchorPrice = currentPrice;

      setMetrics({
        currentPrice,
        skewScore,
        bullBumperHits: cumulativeBullHits,
        bearBumperHits: cumulativeBearHits,
        tickCount: totalTicks,
        dynamicVolatility: rollingVol,
      });
    };

    return () => ws.close();
  }, [isStreaming, symbol]);

  // 3. Monochrome Ink Chart Drawing Logic
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || graphPrices.length === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    // Clear and draw vintage off-white newsprint background for the chart box
    ctx.fillStyle = '#f2ecd9';
    ctx.fillRect(0, 0, width, height);

    // Draw Fine Charcoal Grid lines (WSJ style graph paper)
    ctx.strokeStyle = 'rgba(67, 56, 42, 0.12)';
    ctx.lineWidth = 1;
    const gridSpacing = 20;
    for (let x = 0; x < width; x += gridSpacing) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
    }
    for (let y = 0; y < height; y += gridSpacing) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
    }

    // Calculate Min/Max scale parameters
    const minPrice = Math.min(...graphPrices) * 0.9998;
    const maxPrice = Math.max(...graphPrices) * 1.0002;
    const priceRange = maxPrice - minPrice || 1;

    // Plot out the custom rough-cut ink-line track
    ctx.strokeStyle = '#1c1917'; // Iron gall black ink
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();

    graphPrices.forEach((price, idx) => {
      const x = (idx / (graphPrices.length - 1 || 1)) * (width - 20) + 10;
      const y = height - ((price - minPrice) / priceRange) * (height - 30) - 15;

      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

  }, [graphPrices]);

  const formatTime = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
      // Main Container: Textured Sepia Newsprint Backing
      <main className="min-h-screen bg-[#e8dfc7] text-stone-900 p-6 flex items-center justify-center font-serif selection:bg-stone-800 selection:text-amber-100" style={{ backgroundImage: 'radial-gradient(circle, transparent 20%, #e8dfc7 20%, #e8dfc7 80%, transparent 80%, transparent), radial-gradient(circle, transparent 20%, #e8dfc7 20%, #e8dfc7 80%, transparent 80%, transparent)', backgroundSize: '4px 4px', backgroundColor: '#e2d7ba' }}>

        {/* Heavy Riveted Brass & Iron Mechanism Panel */}
        <div className="max-w-xl w-full bg-[#fcf9f2] border-4 border-double border-stone-800 rounded-xl p-6 space-y-6 shadow-[0_25px_60px_-15px_rgba(43,34,22,0.3)] relative overflow-hidden before:absolute before:inset-0 before:border-8 before:border-stone-800/10 before:pointer-events-none">

          {/* Wall Street Journal Retro Header Block */}
          <div className="text-center border-b-4 border-stone-900 pb-4 relative">
            <div className="text-[10px] uppercase tracking-widest font-mono text-stone-600 mb-1 flex justify-between px-1">
              <span>Est. 1889 Telegraph Terminal</span>
              <span>No. 63,072</span>
            </div>
            <h1 className="text-3xl font-black tracking-tight text-stone-950 uppercase italic font-serif border-y-2 border-stone-900 py-1 my-1">
              The Probability Chronicle
            </h1>

            {/* Controls disguised as industrial dials and levers */}
            <div className="flex justify-between items-center mt-4">
              <div className="flex items-center gap-2 border border-stone-800 bg-[#efe7cc] px-2 py-1 rounded shadow-inner">
                <span className="text-[9px] font-mono uppercase font-bold text-stone-700">Dial Selector:</span>
                <select
                    value={symbol}
                    onChange={(e) => setSymbol(e.target.value)}
                    className="bg-transparent text-xs font-mono font-bold text-stone-900 focus:outline-none cursor-pointer uppercase"
                    disabled={isStreaming}
                >
                  <option value="ethusdt">ETH // USD</option>
                  <option value="btcusdt">BTC // USD</option>
                  <option value="solusdt">SOL // USD</option>
                </select>
              </div>

              <button
                  onClick={() => setIsStreaming(!isStreaming)}
                  className={`px-5 py-2 font-mono text-xs font-extrabold tracking-widest transition-all duration-150 border-2 active:translate-y-0.5 ${
                      isStreaming
                          ? 'bg-red-900 text-amber-100 border-red-950 shadow-inner'
                          : 'bg-stone-950 text-[#fcf9f2] border-stone-950 shadow-[0_4px_0_0_#44403c]'
                  }`}
              >
                {isStreaming ? '⚡ DISENGAGE LEVER' : '🔌 ENGAGE LEVER'}
              </button>
            </div>
          </div>

          {/* Telemetry Display Boxes */}
          {metrics ? (
              <div className="space-y-6 animate-fade-in">

                {/* Live Spot Tracker stylized with glowing Nixie Tube-like framing */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2 bg-stone-950 text-amber-500 font-mono p-3 rounded border-2 border-stone-800 shadow-inner text-center relative overflow-hidden">
                    <span className="text-[9px] text-stone-500 uppercase tracking-widest block mb-0.5 font-sans font-bold">Nixie Spot Feed</span>
                    <span className="text-2xl font-bold tracking-widest block glow-text drop-shadow-[0_0_6px_rgba(245,158,11,0.5)]">
                  ${metrics.currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
                  </div>
                  <div className="bg-stone-950 text-red-500 font-mono p-3 rounded border-2 border-stone-800 shadow-inner text-center relative overflow-hidden">
                    <span className="text-[9px] text-stone-500 uppercase tracking-widest block mb-0.5 font-sans font-bold">Chronometer</span>
                    <span className="text-xl font-bold block tracking-wider pt-0.5 drop-shadow-[0_0_6px_rgba(239,68,68,0.5)]">
                  {formatTime(secondsElapsed)}
                </span>
                  </div>
                </div>

                {/* Steampunk Weighted Balance Scale (Skew score) */}
                <div className="bg-[#efe7cc] border-2 border-stone-800 p-4 rounded shadow-inner space-y-2">
                  <div className="flex justify-between text-xs font-mono font-bold uppercase text-stone-800">
                    <span>⚖️ Bearish Drift</span>
                    <span className="text-stone-950 font-sans font-black">
                  {metrics.skewScore >= 0 ? `+${metrics.skewScore}% Bull Skew` : `${metrics.skewScore}% Bear Skew`}
                </span>
                    <span>Bullish Mass ⚖️</span>
                  </div>

                  <div className="w-full h-4 bg-stone-900 rounded border border-stone-700 p-0.5 relative flex items-center">
                    <div className="absolute left-1/2 -translate-x-1/2 w-1 h-full bg-amber-600 z-10" />
                    <div
                        className="bg-stone-400 h-full transition-all duration-150 ease-out border-r border-stone-600"
                        style={{ width: `${Math.max(0, 50 - (metrics.skewScore / 2))}%` }}
                    />
                    <div
                        className="bg-stone-200 h-full transition-all duration-150 ease-out border-l border-stone-400"
                        style={{ width: `${Math.max(0, 50 + (metrics.skewScore / 2))}%` }}
                    />
                  </div>
                </div>

                {/* Counter Blocks mimicking old mechanical trip-counters */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="border-2 border-stone-800 bg-[#fcf9f2] rounded p-3 text-center shadow">
                    <span className="text-[10px] font-sans font-bold text-red-800 uppercase tracking-wider block border-b border-stone-200 pb-1 mb-2">▼ Bear Escapements</span>
                    <span className="text-3xl font-mono font-bold text-stone-900 tracking-tighter bg-stone-100 px-3 py-0.5 rounded border border-stone-300 shadow-inner inline-block">
                  {metrics.bearBumperHits.toString().padStart(3, '0')}
                </span>
                  </div>
                  <div className="border-2 border-stone-800 bg-[#fcf9f2] rounded p-3 text-center shadow">
                    <span className="text-[10px] font-sans font-bold text-green-800 uppercase tracking-wider block border-b border-stone-200 pb-1 mb-2">▲ Bull Escapements</span>
                    <span className="text-3xl font-mono font-bold text-stone-900 tracking-tighter bg-stone-100 px-3 py-0.5 rounded border border-stone-300 shadow-inner inline-block">
                  {metrics.bullBumperHits.toString().padStart(3, '0')}
                </span>
                  </div>
                </div>

                {/* NEW ADDITION: Monochrome Price Ink Graph Canvas */}
                <div className="border-2 border-stone-900 rounded p-1.5 bg-stone-900/5 shadow-md">
                  <span className="text-[9px] font-mono uppercase font-bold text-stone-600 tracking-wider block mb-1">📋 Galvanometer Ink Recording Matrix</span>
                  <canvas
                      ref={canvasRef}
                      width={480}
                      height={130}
                      className="w-full h-[130px] border border-stone-400 rounded"
                  />
                </div>

                {/* Micro-printed Log summary */}
                <div className="flex justify-between text-[9px] font-mono text-stone-500 uppercase font-bold px-1 border-t border-stone-200 pt-2">
                  <span>Cycles Transmitted: {metrics.tickCount}</span>
                  <span>Pressure Matrix: {(metrics.tickCount / (secondsElapsed || 1)).toFixed(1)} cyc/sec</span>
                </div>
              </div>
          ) : (
              <div className="h-64 flex flex-col items-center justify-center text-xs text-stone-500 italic border-2 border-dashed border-stone-300 rounded-lg bg-stone-50/50 p-6 text-center space-y-2">
                <div>⚙️ System Pressure Neutralized ⚙️</div>
                <div className="text-[10px] font-sans not-italic text-stone-400 max-w-[280px]">Pull the mechanical engine lever above to initialize the rolling standard-deviation pipeline.</div>
              </div>
          )}

          {/* Lower Calibration Diagnostics */}
          <div className="border-t-2 border-stone-900 pt-4 bg-stone-100/50 rounded-b-lg -mx-6 -mb-6 p-6 border-dotted">
            <div className="grid grid-cols-3 gap-3 text-[10px] font-mono font-bold text-stone-700">
              <div>
                <span className="block text-[9px] text-stone-500 uppercase mb-0.5">Horizon (Days)</span>
                <input type="number" value={days} onChange={e => setDays(Number(e.target.value))} className="w-full bg-[#fcf9f2] border border-stone-400 rounded px-2 py-1 text-stone-950 focus:outline-none focus:border-stone-800 font-bold shadow-inner" />
              </div>
              <div>
                <span className="block text-[9px] text-stone-500 uppercase mb-0.5">Paths (Sample)</span>
                <input type="number" value={iterations} onChange={e => setIterations(Number(e.target.value))} className="w-full bg-[#fcf9f2] border border-stone-400 rounded px-2 py-1 text-stone-950 focus:outline-none focus:border-stone-800 font-bold shadow-inner" />
              </div>
              <div>
                <span className="block text-[9px] text-stone-500 uppercase mb-0.5">Atmospheric Variance</span>
                <div className="w-full bg-stone-950 border border-stone-800 text-blue-400 rounded px-2 py-1.5 font-bold tracking-wider shadow-inner text-center">
                  {metrics ? `${(metrics.dynamicVolatility * 100).toFixed(1)}% VAR` : 'STATIC'}
                </div>
              </div>
            </div>
          </div>

        </div>
      </main>
  );
}