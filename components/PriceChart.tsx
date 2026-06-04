'use client';

import { useEffect, useRef } from 'react';
import { createChart, IChartApi, ISeriesApi, LineSeries } from 'lightweight-charts';

interface PriceChartProps {
    historicalData: { time: number; value: number }[];
    liveTick: { time: number; value: number } | null;
    simData: { timestamps: number[]; paths: number[][] } | null;
}

export default function PriceChart({ historicalData, liveTick, simData }: PriceChartProps) {
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const mainSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
    const simSeriesRef = useRef<ISeriesApi<'Line'>[]>([]);

    // 1. Initialize Chart & Load initial historical data
    useEffect(() => {
        if (!chartContainerRef.current) return;

        const chart = createChart(chartContainerRef.current, {
            width: chartContainerRef.current.clientWidth,
            height: 500,
            layout: { background: { color: '#131722' }, textColor: '#d1d4dc' },
            grid: { vertLines: { color: '#242832' }, horzLines: { color: '#242832' } },
            timeScale: { timeVisible: true, secondsVisible: true }, // Turn on seconds for live streaming
        });
        chartRef.current = chart;

        const mainSeries = chart.addSeries(LineSeries, {
            color: '#2962FF',
            lineWidth: 3,
            title: 'Live Price',
        });
        mainSeries.setData(historicalData);
        mainSeriesRef.current = mainSeries;

        const handleResize = () => {
            if (chartContainerRef.current && chartRef.current) {
                chartRef.current.applyOptions({ width: chartContainerRef.current.clientWidth });
            }
        };
        window.addEventListener('resize', handleResize);

        return () => {
            window.removeEventListener('resize', handleResize);
            chart.remove();
        };
    }, [historicalData]);

    // 2. Stream new live ticks into the chart
    useEffect(() => {
        if (liveTick && mainSeriesRef.current) {
            mainSeriesRef.current.update(liveTick);
        }
    }, [liveTick]);

    // 3. Clear old simulation lines and draw the updated continuous paths
    useEffect(() => {
        if (!chartRef.current) return;

        // Remove previous simulation lines from the canvas
        simSeriesRef.current.forEach(series => {
            try { chartRef.current?.removeSeries(series); } catch (e) {}
        });
        simSeriesRef.current = [];

        // Draw the new forecast paths
        if (simData && simData.paths.length > 0) {
            simData.paths.forEach((path, index) => {
                const lineSeries = chartRef.current!.addSeries(LineSeries, {
                    color: index === 0 ? '#ff4a4a' : 'rgba(233, 30, 99, 0.12)',
                    lineWidth: 1,
                    lineStyle: 2,
                });

                const seriesData = path.map((price, stepIndex) => ({
                    time: simData.timestamps[stepIndex],
                    value: price,
                }));

                lineSeries.setData(seriesData);
                simSeriesRef.current.push(lineSeries);
            });
        }
    }, [simData]);

    return <div ref={chartContainerRef} className="w-full h-[500px] rounded-lg overflow-hidden border border-gray-800" />;
}