'use client';

interface SimControlsProps {
    days: number;
    setDays: (v: number) => void;
    iterations: number;
    setIterations: (v: number) => void;
    volatility: number;
    setVolatility: (v: number) => void;
    isStreaming: boolean; // Add this new prop
}

export default function SimControls({
                                        days,
                                        setDays,
                                        iterations,
                                        setIterations,
                                        volatility,
                                        setVolatility,
                                        isStreaming, // Destructure it here
                                    }: SimControlsProps) {
    return (
        <div className="bg-gray-900 p-6 rounded-xl border border-gray-800 space-y-4 h-fit">
            <h2 className="text-sm uppercase font-bold tracking-wider text-gray-400 border-b border-gray-800 pb-2">
                Simulation Inputs
            </h2>

            {/* Horizon Input */}
            <div>
                <label className="block text-[10px] uppercase text-gray-500 font-bold mb-1">Horizon (Days)</label>
                <input type="number" value={days} onChange={e => setDays(Number(e.target.value))} className="w-full bg-gray-950 border border-gray-800 rounded px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-blue-500" />
            </div>

            {/* Iterations Input */}
            <div>
                <label className="block text-[10px] uppercase text-gray-500 font-bold mb-1">Simulated Paths</label>
                <input type="number" value={iterations} onChange={e => setIterations(Number(e.target.value))} className="w-full bg-gray-950 border border-gray-800 rounded px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-blue-500" />
            </div>

            {/* Volatility Input */}
            <div>
                <label className="block text-[10px] uppercase text-gray-500 font-bold mb-1">Annual Volatility</label>
                <input type="number" step="0.05" value={volatility} onChange={e => setVolatility(Number(e.target.value))} className="w-full bg-gray-950 border border-gray-800 rounded px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-blue-500" />
            </div>

            {/* Conditional Status Banner / Button */}
            {isStreaming ? (
                <div className="w-full bg-blue-950/40 border border-blue-900 text-blue-400 text-center text-xs font-bold py-2.5 rounded animate-pulse">
                    ⚡ ENGINE LIVE & RUNNING
                </div>
            ) : (
                <div className="w-full bg-gray-950 border border-gray-800 text-gray-500 text-center text-xs font-bold py-2.5 rounded italic">
                    Await engine start...
                </div>
            )}
        </div>
    );
}