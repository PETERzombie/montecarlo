'use client';

import { useState, useEffect, useRef } from 'react';
import { runMonteCarlo, SimResults } from '@/utils/monteCarlo';

interface MomentumMetrics {
  currentPrice: number;
  skewScore: number;       // Ranges from -100 (Extreme Bearish) to +100 (Extreme Bullish)
  bullBumperHits: number;  // Total times upper threshold was breached
  bearBumperHits: number;  // Total times lower threshold was breached
  tickCount: number;
  dynamicVolatility: number; // The real-time annualized statistical volatility
}

export default function Dashboard() {
  const [symbol, setSymbol] = useState('ethusdt');
  const [isStreaming, setIsStreaming] = useState(false);
  const [metrics, setMetrics] = useState<MomentumMetrics | null>(null);

  // Timer States
  const [secondsElapsed, setSecondsElapsed] = useState(0);

  // Simulation Parameters (Volatility is now automated, input box removed)
  const [days, setDays] = useState(15);
  const [iterations, setIterations] = useState(400);

  // Keep fresh structural variables available to the high-frequency thread
  const paramsRef = useRef({ days, iterations });
  useEffect(() => {
    paramsRef.current = { days, iterations };
  }, [days, iterations]);

  // 1. Session Timer Hook
  useEffect(() => {
    let timerId: NodeJS.Timeout;

    if (isStreaming) {
      setSecondsElapsed(0);
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

  // 2. High-Frequency Adaptive WebSocket & Monte Carlo Hook
  useEffect(() => {
    if (!isStreaming) {
      setMetrics(null);
      return;
    }

    let totalTicks = 0;
    let cumulativeBullHits = 0;
    let cumulativeBearHits = 0;
    let anchorPrice = 0;

    // Memory arrays to compute rolling historical volatility over a 50-tick lookback window
    const priceHistory: number[] = [];
    const maxLookback = 50;
    let rollingVol = 0.50; // Fallback initial default (50%) until history fills

    const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${symbol}@aggTrade`);

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      const currentPrice = parseFloat(data.p);
      totalTicks++;

      // A. Push current price into the calculation array
      priceHistory.push(currentPrice);
      if (priceHistory.length > maxLookback) {
        priceHistory.shift();
      }

      // B. Compute Log-Returns and Statistical Standard Deviation
      if (priceHistory.length >= 5) {
        const logReturns: number[] = [];
        for (let i = 1; i < priceHistory.length; i++) {
          logReturns.push(Math.log(priceHistory[i] / priceHistory[i - 1]));
        }

        // Calculate Variance
        const meanReturn = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
        const squaredDiffs = logReturns.map(r => Math.pow(r - meanReturn, 2));
        const variance = squaredDiffs.reduce((a, b) => a + b, 0) / (logReturns.length - 1 || 1);
        const tickDeviation = Math.sqrt(variance);

        // Annualize the variance based on an average crypto tick frequency (~2 trades per second)
        // Scaler = tickDev * sqrt(60 seconds * 60 mins * 24 hours * 365 days * 2 average ticks/sec)
        const annualizationScaler = Math.sqrt(63072000);
        const computedVol = tickDeviation * annualizationScaler;

        // Smooth out erratic tick spikes using a 10% exponential moving window filter
        // Clamped between 10% and 150% to prevent extreme WebSocket data anomalies
        rollingVol = (rollingVol * 0.9) + (computedVol * 0.1);
        rollingVol = Math.max(0.10, Math.min(1.50, rollingVol));
      }

      const currentParams = paramsRef.current;

      if (totalTicks === 1 || anchorPrice === 0) {
        anchorPrice = currentPrice;
      }

      // Run Monte Carlo using our brand new ADAPTIVE rolling volatility metric
      const simResults: SimResults = runMonteCarlo(
          currentPrice,
          currentParams.days,
          currentParams.iterations,
          0.02,
          rollingVol
      );

      const finalPrices = simResults.paths.map(path => path[path.length - 1]);

      // Dynamic Bollinger Guard Rails (Adjusts automatically when rollingVol squeezes)
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

      // Skew Calculation
      const pathsAboveCurrent = finalPrices.filter(p => p > currentPrice).length;
      const rawRatio = pathsAboveCurrent / currentParams.iterations;
      const skewScore = Math.round((rawRatio - 0.5) * 200);

      if (totalTicks % 100 === 0) {
        anchorPrice = currentPrice;
      }

      setMetrics({
        currentPrice,
        skewScore,
        bullBumperHits: cumulativeBullHits,
        bearBumperHits: cumulativeBearHits,
        tickCount: totalTicks,
        dynamicVolatility: rollingVol,
      });
    };

    ws.onerror = (err) => console.error('WebSocket Error:', err);

    return () => {
      ws.close();
    };
  }, [isStreaming, symbol]);

  const formatTime = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
      <main className="min-h-screen bg-gray-950 text-gray-100 p-8 font-mono flex items-center justify-center">
        <div className="max-w-xl w-full bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-6 shadow-2xl">

          {/* Top Control Header */}
          <div className="flex justify-between items-center border-b border-gray-800 pb-4">
            <div className="flex items-center gap-3">
              <svg className="w-10 h-10 text-green-500" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M5 90H95" stroke="#374151" strokeWidth="3" strokeLinecap="round"/>
                <path d="M5 90C25 90 30 15 45 40C55 58 70 90 95 90" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/>
                <circle cx="45" cy="40" r="4" fill="#EF4444"/>
              </svg>

              <div>
                <h1 className="text-lg font-bold tracking-tight text-white">Probability Momentum</h1>
                <select
                    value={symbol}
                    onChange={(e) => setSymbol(e.target.value)}
                    className="bg-transparent text-xs text-gray-400 font-bold focus:outline-none mt-0.5 cursor-pointer"
                    disabled={isStreaming}
                >
                  <option value="ethusdt">ETH/USDT</option>
                  <option value="btcusdt">BTC/USDT</option>
                  <option value="solusdt">SOL/USDT</option>
                </select>
              </div>
            </div>

            <button
                onClick={() => setIsStreaming(!isStreaming)}
                className={`px-4 py-2 rounded text-xs font-bold transition tracking-wider ${
                    isStreaming ? 'bg-red-600/20 text-red-400 border border-red-500/30' : 'bg-green-600 text-white'
                }`}
            >
              {isStreaming ? 'STOP STREAM' : 'START STREAM'}
            </button>
          </div>

          {/* Real-time Scoreboard Output */}
          {metrics ? (
              <div className="space-y-6">
                {/* Live Big Number & Running Stop Watch Timer */}
                <div className="relative bg-gray-950/50 rounded-xl border border-gray-800/50 p-4 text-center">
                  <div className="absolute top-3 right-4 bg-gray-900 border border-gray-800 px-2 py-0.5 rounded text-[10px] text-blue-400 font-bold tracking-widest">
                    ⏱️ {formatTime(secondsElapsed)}
                  </div>

                  <span className="text-[10px] text-gray-500 uppercase tracking-widest block mb-1">Live Spot Price</span>
                  <span className="text-3xl font-extrabold text-white tracking-tight">
                ${metrics.currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
                </div>

                {/* Skew Metric Component */}
                <div className="space-y-2">
                  <div className="flex justify-between text-xs font-bold uppercase tracking-wider">
                    <span className="text-gray-400">Distribution Skew</span>
                    <span className={metrics.skewScore >= 0 ? 'text-green-400' : 'text-red-400'}>
                  {metrics.skewScore >= 0 ? `+${metrics.skewScore}% Bullish` : `${metrics.skewScore}% Bearish`}
                </span>
                  </div>

                  {/* Fluid Visual Meter */}
                  <div className="w-full h-3 bg-gray-950 rounded-full overflow-hidden flex border border-gray-800">
                    <div
                        className="bg-red-500 transition-all duration-100 ease-out h-full"
                        style={{ width: `${Math.max(0, -metrics.skewScore)}%`, marginLeft: 'auto' }}
                    />
                    <div className="w-0.5 bg-gray-700 h-full" />
                    <div
                        className="bg-green-500 transition-all duration-100 ease-out h-full"
                        style={{ width: `${Math.max(0, metrics.skewScore)}%`, marginRight: 'auto' }}
                    />
                  </div>
                </div>

                {/* Bumper Counter Grid */}
                <div className="grid grid-cols-2 gap-4 pt-2">
                  <div className="bg-gray-950 p-4 rounded-xl border border-gray-800/60 text-center">
                    <span className="text-[10px] text-red-500 font-bold uppercase block mb-1">Bear Bumper Hits</span>
                    <span className="text-xl font-bold text-gray-200">{metrics.bearBumperHits}</span>
                  </div>
                  <div className="bg-gray-950 p-4 rounded-xl border border-gray-800/60 text-center">
                    <span className="text-[10px] text-green-500 font-bold uppercase block mb-1">Bull Bumper Hits</span>
                    <span className="text-xl font-bold text-gray-200">{metrics.bullBumperHits}</span>
                  </div>
                </div>

                {/* Telemetry Stats Summary */}
                <div className="flex justify-between text-[10px] text-gray-600 uppercase tracking-widest px-1">
                  <span>Ticks Evaluated: {metrics.tickCount}</span>
                  <span>Velocity: {secondsElapsed > 0 ? (metrics.tickCount / secondsElapsed).toFixed(1) : 0} T/S</span>
                </div>
              </div>
          ) : (
              <div className="h-44 flex items-center justify-center text-xs text-gray-500 italic">
                Engine offline. Toggle stream to start math calculations.
              </div>
          )}

          {/* Dynamic Telemetry Trackers */}
          <div className="border-t border-gray-800/60 pt-4 opacity-70 hover:opacity-100 transition-opacity">
            <div className="grid grid-cols-3 gap-2 text-[10px] text-gray-400">
              <div>
                <span className="block text-gray-600 uppercase font-bold mb-0.5">Horizon (Days)</span>
                <input type="number" value={days} onChange={e => setDays(Number(e.target.value))} className="w-full bg-gray-950 border border-gray-800 rounded px-2 py-1 text-gray-200 focus:outline-none focus:border-blue-500" />
              </div>
              <div>
                <span className="block text-gray-600 uppercase font-bold mb-0.5">Paths (Sample)</span>
                <input type="number" value={iterations} onChange={e => setIterations(Number(e.target.value))} className="w-full bg-gray-950 border border-gray-800 rounded px-2 py-1 text-gray-200 focus:outline-none focus:border-blue-500" />
              </div>
              <div>
                <span className="block text-gray-600 uppercase font-bold mb-0.5">Adaptive Volatility</span>
                <div className="w-full bg-gray-950/40 border border-gray-800/80 rounded px-2 py-1.5 font-bold text-blue-400">
                  {metrics ? `${(metrics.dynamicVolatility * 100).toFixed(1)}%` : 'Calibrating...'}
                </div>
              </div>
            </div>
          </div>

        </div>
      </main>
  );
}