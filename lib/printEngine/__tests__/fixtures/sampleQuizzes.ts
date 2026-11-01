// lib/printEngine/__tests__/fixtures/sampleQuizzes.ts

import { GeneratedAssessment } from '../../types';

export const quiz10ItemMC: GeneratedAssessment = {
    quizTitle: 'Basic Networking Concepts (10 Items)',
    questions: Array.from({ length: 10 }, (_, i) => ({
        questionNumber: i + 1,
        type: 'multiple_choice' as const,
        questionText: `What is the primary role of standard network protocol layer ${i + 1}?`,
        options: ['Data transmission', 'Physical storage', 'Visual rendering', 'Power supply'],
        answerBoxesRequired: 1,
    })),
    answerKey: Array.from({ length: 10 }, (_, i) => ({
        questionNumber: i + 1,
        correctAnswer: ['A', 'B', 'C', 'D'][i % 4],
        points: 1,
    })),
};

export const quiz20ItemMC: GeneratedAssessment = {
    quizTitle: 'Computer Hardware Fundamentals (20 Items)',
    questions: Array.from({ length: 20 }, (_, i) => ({
        questionNumber: i + 1,
        type: 'multiple_choice' as const,
        questionText: `Which hardware component handles instruction cycle processing step ${i + 1}?`,
        options: ['Central Processing Unit', 'Random Access Memory', 'Solid State Drive', 'Graphics Unit'],
        answerBoxesRequired: 1,
    })),
    answerKey: Array.from({ length: 20 }, (_, i) => ({
        questionNumber: i + 1,
        correctAnswer: ['A', 'B', 'C', 'D'][i % 4],
        points: 1,
    })),
};

export const quiz40ItemMixed: GeneratedAssessment = {
    quizTitle: 'Introduction to Client-Server Systems & Networks',
    questions: [
        // Part I: Multiple Choice (1-12)
        ...Array.from({ length: 12 }, (_, i) => ({
            questionNumber: i + 1,
            type: 'multiple_choice' as const,
            questionText: `Multiple choice question text for client-server network component item ${i + 1}?`,
            options: ['Server device', 'Client terminal', 'Router bridge', 'Firewall gateway'],
            answerBoxesRequired: 1,
        })),
        // Part II: True or False (13-20)
        ...Array.from({ length: 8 }, (_, i) => ({
            questionNumber: i + 13,
            type: 'true_false' as const,
            questionText: `A server can host concurrent requests reliably under normal load (Statement ${i + 1}).`,
            options: ['True', 'False'],
            answerBoxesRequired: 1,
        })),
        // Part III: Word Box (21-25)
        ...Array.from({ length: 5 }, (_, i) => ({
            questionNumber: i + 21,
            type: 'word_box' as const,
            questionText: `Word box clue description for networking term item ${i + 1}:`,
            options: ['A) PROTOCOL', 'B) SOCKET', 'C) PACKET', 'D) PORT', 'E) BUFFER', 'F) THREAD'],
            answerBoxesRequired: 1,
        })),
        // Part IV: Fill in the Blank (26-30)
        ...Array.from({ length: 5 }, (_, i) => ({
            questionNumber: i + 26,
            type: 'fill_blank' as const,
            questionText: `The protocol used to securely transmit web documents is known as _______.`,
            options: [],
            answerBoxesRequired: 1,
        })),
        // Part V: Identification (31-36)
        ...Array.from({ length: 6 }, (_, i) => ({
            questionNumber: i + 31,
            type: 'identification' as const,
            questionText: `Identify the system service that translates domain names into numerical IP addresses.`,
            options: [],
            answerBoxesRequired: 1,
        })),
        // Part VI: Enumeration (37-40)
        ...Array.from({ length: 4 }, (_, i) => ({
            questionNumber: i + 37,
            type: 'enumeration' as const,
            questionText: `Enumerate key server hardware components:`,
            options: [],
            answerBoxesRequired: i === 0 ? 3 : 4,
        })),
    ],
    answerKey: Array.from({ length: 40 }, (_, i) => ({
        questionNumber: i + 1,
        correctAnswer: i < 12 ? 'B' : i < 20 ? 'T' : i < 25 ? 'A' : 'HTTPS',
        points: 1,
    })),
};
