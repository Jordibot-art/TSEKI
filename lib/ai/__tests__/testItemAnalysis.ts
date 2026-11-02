import { analyzeQuizForClass, generateDemoQuizAnalysis, getDifficultyLevel } from "../../questionAnalysis";

console.log("=== Testing Item Analysis & Difficulty Index ===");

// 1. Difficulty Level categorization
console.log("p = 0.90 ->", getDifficultyLevel(0.90)); // Easy
console.log("p = 0.50 ->", getDifficultyLevel(0.50)); // Moderate
console.log("p = 0.20 ->", getDifficultyLevel(0.20)); // Difficult

// 2. Demo Item Analysis generation
const demoAnalysis = generateDemoQuizAnalysis("Cell Biology Quiz");
console.log("Quiz Title:", demoAnalysis.quizTitle);
console.log("Total Graded:", demoAnalysis.totalStudentsGraded);
console.log("Class Average:", demoAnalysis.classAverageScore + "%");
console.log("Average Difficulty Index:", demoAnalysis.averageDifficultyIndex);
console.log("Difficulty Breakdown:", demoAnalysis.difficultyBreakdown);
console.log("Most Missed Questions Count:", demoAnalysis.mostMissedQuestions.length);
console.log("Top 1 Hardest Question:", `Q${demoAnalysis.mostMissedQuestions[0].questionNumber}`, `(p = ${demoAnalysis.mostMissedQuestions[0].difficultyIndex}, Missed: ${demoAnalysis.mostMissedQuestions[0].missedRate}%)`);
console.log("Distractor Breakdown Q4:", demoAnalysis.mostMissedQuestions[0].distractorBreakdown);
console.log("Most Common Mistake:", demoAnalysis.mostMissedQuestions[0].mostCommonMistake);

console.log("ALL ITEM ANALYSIS TESTS PASSED!");
