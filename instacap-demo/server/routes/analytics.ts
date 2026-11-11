import { RequestHandler } from "express";
import { trackEvent } from "../analytics";

export const handleTrackEvent: RequestHandler = (req, res) => {
  try {
    const { type, data } = req.body;

    if (!type) {
      res.status(400).json({ success: false, error: 'Event type is required' });
      return;
    }

    trackEvent({
      timestamp: Date.now(),
      type,
      data
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Error tracking event:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to track event' 
    });
  }
};
