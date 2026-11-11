import PQueue from 'p-queue';

// Queue for managing concurrent caption extraction
// Browser pool tufayli xotira kamroq sarflanadi, shuning uchun concurrency yuqoriroq
export const captionQueue = new PQueue({
  concurrency: 8,
  timeout: 60000 // 60 soniya timeout (barqarorroq ishlashi uchun)
});

// Queue statistikasi
export function getQueueStats() {
  return {
    size: captionQueue.size,
    pending: captionQueue.pending,
    isPaused: captionQueue.isPaused
  };
}

// Queue'ni tozalash
export function clearQueue() {
  captionQueue.clear();
}
