import { PDFDocument } from 'pdf-lib';
import { renderBookletPDF } from './bookletRenderer';
import { GeneratedAssessment, PrintOptions } from './types';

/**
 * Curated 2-page assessment with mathematical and scientific symbols,
 * arrows, Greek letters, and curly quotes to stress-test fontkit and layout.
 */
export const smokeTestAssessment: GeneratedAssessment = {
    quizTitle: 'Print Engine On-Device Smoke Test (2-Page Verification)',
    questions: [
        // Page 1 questions (1 - 12)
        {
            questionNumber: 1,
            type: 'multiple_choice',
            questionText: 'Which condition guarantees static equilibrium where net force F_net ≥ 0 and torque τ = 0?',
            options: ['Linear momentum conserved', 'Angular acceleration α = 0', 'Energy loss ΔE > 0', 'Velocity v → ∞'],
            answerBoxesRequired: 1,
        },
        {
            questionNumber: 2,
            type: 'multiple_choice',
            questionText: 'For a wave equation with wavelength λ and frequency f, the wave propagation speed is given by:',
            options: ['v = λ · f', 'v = λ / f', 'v = f / λ', 'v = 2π · f · λ'],
            answerBoxesRequired: 1,
        },
        {
            questionNumber: 3,
            type: 'multiple_choice',
            questionText: 'In thermodynamics, heat engine efficiency η satisfies the inequality: η ≤ 1 - (T_c / T_h).',
            options: ['Carnot Theorem', 'Ohm’s Law', 'Bernoulli Principle', 'Coulomb Force'],
            answerBoxesRequired: 1,
        },
        {
            questionNumber: 4,
            type: 'true_false',
            questionText: 'The symbol “≥” means greater than or equal to, and “≤” means less than or equal to.',
            options: ['True', 'False'],
            answerBoxesRequired: 1,
        },
        {
            questionNumber: 5,
            type: 'true_false',
            questionText: 'Directional flux transitions represented as A → B maintain total energy conservation.',
            options: ['True', 'False'],
            answerBoxesRequired: 1,
        },
        {
            questionNumber: 6,
            type: 'multiple_choice',
            questionText: 'Given angle θ where 0 ≤ θ ≤ π/2 radians, what is the value of cos(π/2)?',
            options: ['0', '1', '1/2', '√2 / 2'],
            answerBoxesRequired: 1,
        },
        {
            questionNumber: 7,
            type: 'multiple_choice',
            questionText: 'Which fundamental constant is symbolized by Planck’s reduced constant ħ = h / (2π)?',
            options: ['Dirac constant', 'Boltzmann constant k_B', 'Stefan-Boltzmann σ', 'Permittivity ε_0'],
            answerBoxesRequired: 1,
        },
        {
            questionNumber: 8,
            type: 'multiple_choice',
            questionText: 'For radioactive decay with half-life T_half, the activity rate is proportional to e^(-λt).',
            options: ['Exponential decay', 'Logarithmic gain', 'Linear acceleration', 'Harmonic resonance'],
            answerBoxesRequired: 1,
        },
        {
            questionNumber: 9,
            type: 'multiple_choice',
            questionText: 'The magnetic flux Φ_B through a closed surface is always zero: ∮ B · dA = 0.',
            options: ['Gauss’s Law for Magnetism', 'Faraday’s Law', 'Ampere’s Law', 'Lorentz Law'],
            answerBoxesRequired: 1,
        },
        {
            questionNumber: 10,
            type: 'multiple_choice',
            questionText: 'In electrical circuits, total impedance Z in an RLC series loop satisfies Z = √(R² + (X_L - X_C)²).',
            options: ['True resonance state', 'Direct current only', 'Open loop condition', 'Zero reactance'],
            answerBoxesRequired: 1,
        },
        {
            questionNumber: 11,
            type: 'multiple_choice',
            questionText: 'A fluid traveling through a constricting pipe accelerates: A_1 · v_1 = A_2 · v_2 (v_2 > v_1).',
            options: ['Continuity equation', 'Archimedes buoyancy', 'Pascal principle', 'Torricelli law'],
            answerBoxesRequired: 1,
        },
        {
            questionNumber: 12,
            type: 'multiple_choice',
            questionText: 'Photon energy E is directly proportional to wave frequency: E = h · ν (or E = h · f).',
            options: ['Photoelectric effect', 'Compton scattering', 'Bragg diffraction', 'Zeeman effect'],
            answerBoxesRequired: 1,
        },
        // Page 2 questions (13 - 24)
        {
            questionNumber: 13,
            type: 'multiple_choice',
            questionText: 'In relativistic mechanics, rest energy is represented by Einstein’s equation E_0 = m_0 · c².',
            options: ['Mass-energy equivalence', 'Gravitational red shift', 'Time dilation', 'Length contraction'],
            answerBoxesRequired: 1,
        },
        {
            questionNumber: 14,
            type: 'multiple_choice',
            questionText: 'The standard gravitational force between two masses m_1 and m_2 is F = G · (m_1 · m_2) / r².',
            options: ['Inverse-square law', 'Hooke’s elasticity law', 'Coulomb electrostatics', 'Kepler’s third harmonic'],
            answerBoxesRequired: 1,
        },
        {
            questionNumber: 15,
            type: 'multiple_choice',
            questionText: 'Which particle interaction mediated by vector bosons W⁺, W⁻, and Z⁰ causes beta decay?',
            options: ['Weak nuclear force', 'Strong color force', 'Electromagnetic force', 'Gravitation'],
            answerBoxesRequired: 1,
        },
        {
            questionNumber: 16,
            type: 'multiple_choice',
            questionText: 'Thermal conductivity rate dQ/dt = -k · A · (dT/dx) is commonly known as:',
            options: ['Fourier’s conduction law', 'Newton’s cooling law', 'Stefan’s radiation', 'Wien’s displacement'],
            answerBoxesRequired: 1,
        },
        {
            questionNumber: 17,
            type: 'true_false',
            questionText: 'Greek alphabet characters α (alpha), β (beta), γ (gamma), and Ω (omega) render cleanly in Noto Sans.',
            options: ['True', 'False'],
            answerBoxesRequired: 1,
        },
        {
            questionNumber: 18,
            type: 'true_false',
            questionText: 'Curved smart quotes “Tseki Print Engine” and dashes — do not cause character code crashes.',
            options: ['True', 'False'],
            answerBoxesRequired: 1,
        },
        {
            questionNumber: 19,
            type: 'multiple_choice',
            questionText: 'Angular momentum L for a rotating rigid body with moment of inertia I and angular velocity ω is:',
            options: ['L = I · ω', 'L = I / ω', 'L = 1/2 · I · ω²', 'L = τ · t'],
            answerBoxesRequired: 1,
        },
        {
            questionNumber: 20,
            type: 'multiple_choice',
            questionText: 'The ratio of circumference to diameter of any planar circle is symbolized by the constant π ≈ 3.14159.',
            options: ['Archimedes constant π', 'Euler constant e', 'Golden ratio φ', 'Euler-Mascheroni γ'],
            answerBoxesRequired: 1,
        },
        {
            questionNumber: 21,
            type: 'multiple_choice',
            questionText: 'Simple harmonic oscillation displacement equation: x(t) = A · cos(ωt + φ).',
            options: ['Harmonic motion', 'Damped oscillation', 'Driven resonance', 'Chaotic attractor'],
            answerBoxesRequired: 1,
        },
        {
            questionNumber: 22,
            type: 'multiple_choice',
            questionText: 'The uncertainty principle dictates that Δx · Δp ≥ ħ / 2 for simultaneous position-momentum measurements.',
            options: ['Heisenberg uncertainty', 'Pauli exclusion', 'Schrodinger equation', 'De Broglie hypothesis'],
            answerBoxesRequired: 1,
        },
        {
            questionNumber: 23,
            type: 'multiple_choice',
            questionText: 'Resistivity ρ relates resistance R to wire length L and area A by: R = ρ · (L / A).',
            options: ['Pouillet’s Law', 'Kirchhoff’s Current Law', 'Lenz’s Law', 'Faraday’s Induction'],
            answerBoxesRequired: 1,
        },
        {
            questionNumber: 24,
            type: 'multiple_choice',
            questionText: 'Work done by an expanding gas during an isobaric process is calculated as W = P · ΔV.',
            options: ['Thermodynamic work', 'Isochoric heating', 'Adiabatic expansion', 'Isothermal compression'],
            answerBoxesRequired: 1,
        },
    ],
    answerKey: Array.from({ length: 24 }, (_, i) => ({
        questionNumber: i + 1,
        correctAnswer: ['A', 'B', 'C', 'D'][i % 4],
        points: 1,
    })),
};

export interface SmokeTestResult {
    success: boolean;
    durationMs: number;
    pageCount: number;
    byteSize: number;
    pdfBytes: Uint8Array;
    error?: string;
}

/**
 * Executes the on-device smoke test:
 * 1. Generates a 2-page assessment Question Booklet PDF with embedded Noto Sans font.
 * 2. Measures generation elapsed time in milliseconds.
 * 3. Inspects and validates page count (must be exactly 2).
 */
export async function runOnDeviceSmokeTest(options: PrintOptions = {}): Promise<SmokeTestResult> {
    const startTime = (typeof performance !== 'undefined' && performance.now)
        ? performance.now()
        : Date.now();

    try {
        const opts: PrintOptions = {
            paperSize: 'short',
            version: 'A',
            quizId: 'SMOKE-TEST-001',
            subject: 'Physics & Applied Mathematics',
            gradeLevel: 'Grade 11',
            ...options,
        };

        const pdfBytes = await renderBookletPDF(smokeTestAssessment, opts);

        const endTime = (typeof performance !== 'undefined' && performance.now)
            ? performance.now()
            : Date.now();

        const durationMs = Math.round(endTime - startTime);

        // Load document to strictly verify page count and validity
        const doc = await PDFDocument.load(pdfBytes);
        const pageCount = doc.getPageCount();

        return {
            success: pageCount === 2,
            durationMs,
            pageCount,
            byteSize: pdfBytes.length,
            pdfBytes,
            error: pageCount !== 2 ? `Expected 2 pages, got ${pageCount}` : undefined,
        };
    } catch (err: any) {
        const endTime = (typeof performance !== 'undefined' && performance.now)
            ? performance.now()
            : Date.now();

        return {
            success: false,
            durationMs: Math.round(endTime - startTime),
            pageCount: 0,
            byteSize: 0,
            pdfBytes: new Uint8Array(),
            error: err.message || 'Unknown smoke test error',
        };
    }
}
