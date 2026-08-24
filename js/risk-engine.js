/**
 * RoadGuard Risk Engine
 * -----------------------------------------------------------------------
 * Combines historical accident-zone data with simulated real-time vehicle
 * telemetry into a single 0-100 risk score.
 *
 * Risk Score = 0.40 * historical + 0.20 * speed + 0.20 * braking
 *            + 0.10 * turning    + 0.10 * context
 *
 * This is a prototype heuristic, not a trained ML model. Vehicle behavior
 * (braking/turning/speed) is treated as a RISK SIGNAL, not proof that an
 * area is accident-prone — see historicalScore() for the geographic side.
 * -----------------------------------------------------------------------
 */
const RiskEngine = (() => {

  const WEIGHTS = {
    historical: 0.40,
    speed: 0.20,
    braking: 0.20,
    turning: 0.10,
    context: 0.10,
  };

  // Matches the UI's severity vocabulary (LOW / MODERATE / HIGH / CRITICAL)
  const LEVELS = [
    { max: 30, label: "LOW" },
    { max: 55, label: "MODERATE" },
    { max: 75, label: "HIGH" },
    { max: 100, label: "CRITICAL" },
  ];

  function clamp(n, min = 0, max = 100) {
    return Math.max(min, Math.min(max, n));
  }

  function riskLevel(score) {
    for (const l of LEVELS) {
      if (score <= l.max) return l.label;
    }
    return "CRITICAL";
  }

  /**
   * Historical signal: derived from a zone's dataset-average risk_score
   * (0-1) plus its fatal-incident ratio, so zones with worse crash
   * severity outrank zones with merely more (minor) incidents.
   */
  function historicalScore(zone) {
    if (!zone) return 0;
    const base = (zone.avg_risk_score || 0) * 100;
    const sevBreakdown = zone.severity_breakdown || {};
    const total = Object.values(sevBreakdown).reduce((a, b) => a + b, 0) || 1;
    const fatalRatio = (sevBreakdown.fatal || 0) / total;
    return clamp(base * 0.7 + fatalRatio * 100 * 0.3);
  }

  /** How far current speed exceeds a recommended/safe speed for the road. */
  function speedScore(currentSpeed, recommendedSpeed) {
    if (!recommendedSpeed) return 0;
    const over = currentSpeed - recommendedSpeed;
    if (over <= 0) return clamp(10 - Math.abs(over) * 0.2, 0, 10);
    return clamp((over / recommendedSpeed) * 150);
  }

  function brakingScore(suddenBrakingDetected, intensity = 1) {
    return suddenBrakingDetected ? clamp(60 * intensity) : 0;
  }

  function turningScore(sharpTurnDetected, intensity = 1) {
    return sharpTurnDetected ? clamp(50 * intensity) : 0;
  }

  /** Weather / road-type / visibility context. */
  function contextScore({ weather = "clear", roadType = "urban", visibility = "high" } = {}) {
    let score = 0;
    if (weather === "rain") score += 30;
    if (weather === "fog") score += 45;
    if (roadType === "highway") score += 10;
    if (visibility === "low") score += 25;
    return clamp(score);
  }

  /**
   * Main entry point. Pass whatever signals are available; missing ones
   * default to "no risk contribution" so the function is safe to call with
   * partial telemetry (e.g. zone-only, before a trip has started).
   */
  function computeRiskScore({
    zone = null,
    speed = 0,
    recommendedSpeed = 50,
    suddenBraking = false,
    sharpTurn = false,
    context = {},
  } = {}) {
    const historical = historicalScore(zone);
    const speedS = speedScore(speed, recommendedSpeed);
    const brakeS = brakingScore(suddenBraking);
    const turnS = turningScore(sharpTurn);
    const ctxS = contextScore(context);

    const total = clamp(
      WEIGHTS.historical * historical +
      WEIGHTS.speed * speedS +
      WEIGHTS.braking * brakeS +
      WEIGHTS.turning * turnS +
      WEIGHTS.context * ctxS
    );

    return {
      score: Math.round(total),
      level: riskLevel(total),
      breakdown: {
        historical: Math.round(historical),
        speed: Math.round(speedS),
        braking: Math.round(brakeS),
        turning: Math.round(turnS),
        context: Math.round(ctxS),
      },
    };
  }

  return { computeRiskScore, historicalScore, speedScore, riskLevel, WEIGHTS, LEVELS };
})();
