"use client";

import { useState, useEffect } from 'react';
import { defaultModel, models } from '@/app/agent/lib/ai/models';

export function useModelSelection() {
  const [selectedModel, setSelectedModel] = useState<string>(defaultModel);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    try {
      const savedModel = localStorage.getItem('chat_model_preference');
      if (savedModel && models.some(m => m.id === savedModel)) {
        setSelectedModel(savedModel);
      }
    } catch (error) {
      console.error('Failed to read model preference:', error);
    } finally {
      setIsLoaded(true);
    }
  }, []);

  const handleModelChange = (model: string) => {
    setSelectedModel(model);
    try {
      localStorage.setItem('chat_model_preference', model);
    } catch (error) {
      console.error('Failed to save model preference:', error);
    }
  };

  return {
    selectedModel,
    handleModelChange,
    isLoaded
  };
}
