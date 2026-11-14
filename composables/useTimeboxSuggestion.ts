import { computed, type Ref } from 'vue';
import { useTaskStatisticsStore } from '~/store/taskStatistics';
import { translate } from '~/lib/i18n';
import type { TimeboxSuggestion, SimilarTaskMatch, SuggestionConfidence } from '~/types/timeboxSuggestion';
import { SIMILARITY, similarityScore, weightedMedian } from '~/lib/timeboxSimilarity';

/**
 * Configuration constants for suggestion algorithm
 */
const CONFIG = {
  /** Minimum title length to trigger suggestions */
  MIN_TITLE_LENGTH: 3,
  /** Round suggested time to this many minutes */
  TIME_ROUNDING_MINUTES: 5,
  /** Minimum matches for high confidence */
  HIGH_CONFIDENCE_MIN_MATCHES: 5,
  /** Minimum matches for medium confidence */
  MEDIUM_CONFIDENCE_MIN_MATCHES: 2,
};

/**
 * Composable for generating intelligent timebox suggestions based on historic task data
 */
export const useTimeboxSuggestion = () => {
  // Move store calls inside function to prevent module-level circular dependencies
  const statisticsStore = useTaskStatisticsStore();

  /**
   * Determine confidence level based on match count and average similarity
   */
  function determineConfidence(matchCount: number, avgSimilarity: number): SuggestionConfidence {
    if (matchCount >= CONFIG.HIGH_CONFIDENCE_MIN_MATCHES && avgSimilarity >= 0.6) {
      return 'high';
    } else if (matchCount >= CONFIG.MEDIUM_CONFIDENCE_MIN_MATCHES && avgSimilarity >= 0.4) {
      return 'medium';
    }
    return 'low';
  }

  /**
   * Generate human-readable description of the suggestion
   */
  function generateDescription(
    matchCount: number,
    activity: string | null,
    confidence: SuggestionConfidence
  ): string {
    const prefix = confidence === 'high' ? '✓ ' : '';
    if (activity) {
      return prefix + translate('task.timeboxBasedOnSimilarWithActivity', { n: matchCount, activity }, matchCount);
    }

    return prefix + translate('task.timeboxBasedOnSimilar', { n: matchCount }, matchCount);
  }

  /**
   * Calculate timebox suggestion based on title, activity, and topic
   * 
   * @param title - Task title (min 3 characters)
   * @param activity - Optional activity for context (primary factor)
   * @param topic - Optional topic for context (secondary factor)
   * @returns Suggestion object or null if no suitable matches found
   */
  function calculateSuggestion(
    title: string,
    activity: string | null = null,
    topic: string | null = null
  ): TimeboxSuggestion | null {
    // Validate input
    if (!title || title.trim().length < CONFIG.MIN_TITLE_LENGTH) {
      return null;
    }
    
    // Get all completion records
    const records = statisticsStore.completionRecords;
    
    if (records.length === 0) {
      return null;
    }
    
    // Calculate similarity scores for all records
    const scoredRecords = records
      .map(record => ({
        record,
        score: similarityScore({ title, activity, topic }, record),
      }))
      .filter(item => item.score >= SIMILARITY.MIN_SCORE)
      .sort((a, b) => b.score - a.score)
      .slice(0, SIMILARITY.MAX_SIMILAR_TASKS);
    
    // No suitable matches found
    if (scoredRecords.length === 0) {
      return null;
    }
    
    // Build similar task matches (store both activity and topic)
    const similarTasks: SimilarTaskMatch[] = scoredRecords.map(item => ({
      title: item.record.title,
      activity: item.record.activity,
      topic: item.record.topic,
      actualMinutes: Math.round(item.record.actualTimeSpentSeconds / 60),
      similarityScore: item.score,
    }));
    
    // Calculate weighted median of actual time spent
    const weightedData = scoredRecords.map(item => ({
      minutes: item.record.actualTimeSpentSeconds / 60,
      weight: item.score,
    }));
    
    const medianMinutes = weightedMedian(weightedData);
    
    // Round to nearest interval
    const roundedMinutes = Math.max(
      CONFIG.TIME_ROUNDING_MINUTES,
      Math.round(medianMinutes / CONFIG.TIME_ROUNDING_MINUTES) * CONFIG.TIME_ROUNDING_MINUTES
    );
    
    // Calculate average similarity for confidence
    const avgSimilarity = scoredRecords.reduce((sum, item) => sum + item.score, 0) / scoredRecords.length;
    
    // Determine confidence
    const confidence = determineConfidence(scoredRecords.length, avgSimilarity);
    
    // Generate description
    const description = generateDescription(scoredRecords.length, activity, confidence);
    
    return {
      suggestedMinutes: roundedMinutes,
      confidence,
      matchCount: scoredRecords.length,
      matchDescription: description,
      similarTasks,
    };
  }

  /**
   * Reactive suggestion computation
   * 
   * @param title - Ref to title input
   * @param activity - Ref to activity input
   * @param topic - Ref to topic input
   * @returns Computed suggestion that updates when inputs change
   */
  function useSuggestion(
    title: Ref<string>,
    activity: Ref<string | null>,
    topic: Ref<string | null>
  ): Ref<TimeboxSuggestion | null> {
    return computed(() => calculateSuggestion(title.value, activity.value, topic.value));
  }

  return {
    calculateSuggestion,
    useSuggestion,
  };
};
