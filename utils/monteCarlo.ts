export interface SimResults {
    timestamps: number[];
    paths: number[][]; // Array of paths, each path is an array of prices
}

export function runMonteCarlo(
    currentPrice: number,
    days: number,
    iterations: number,
    expectedReturn: number, // Annualized drift (e.g., 0.05)
    volatility: number      // Annualized volatility (e.g., 0.50 for high crypto vol)
): SimResults {
    const dt = 1 / 365; // Time step (daily)
    const paths: number[][] = [];

    // Generate a mock timeline starting from today
    const now = Math.floor(Date.now() / 1000);
    const timestamps: number[] = [];
    for (let d = 0; d <= days; d++) {
        timestamps.push(now + d * 86400);
    }

    for (let i = 0; i < iterations; i++) {
        const path: number[] = [currentPrice];
        let price = currentPrice;

        for (let d = 1; d <= days; d++) {
            // Standard normal random variable using Box-Muller transform
            const u1 = Math.random();
            const u2 = Math.random();
            const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);

            // Geometric Brownian Motion formula
            const drift = (expectedReturn - 0.5 * Math.pow(volatility, 2)) * dt;
            const shock = volatility * z * Math.sqrt(dt);
            price = price * Math.exp(drift + shock);

            path.push(price);
        }
        paths.push(path);
    }

    return { timestamps, paths };
}