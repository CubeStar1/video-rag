"use client"

import * as React from "react"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { models, type Model } from "@/app/agent/lib/ai/models"
import { cn } from "@/lib/utils"


interface ModelSelectorProps {
  selectedModelId: string
  onModelChange: (id: string) => void
  className?: string
}

export function ModelSelector({ selectedModelId, onModelChange, className }: ModelSelectorProps) {
  const groupedModels = React.useMemo(() => {
    return models.reduce((acc, model) => {
      if (!acc[model.provider]) {
        acc[model.provider] = []
      }
      acc[model.provider].push(model)
      return acc
    }, {} as Record<string, Model[]>)
  }, [])

  return (
    <Select value={selectedModelId} onValueChange={onModelChange}>
      <SelectTrigger
        className={cn(
          "w-fit border-none bg-transparent font-medium text-muted-foreground shadow-none transition-colors hover:bg-accent hover:text-foreground aria-expanded:bg-accent aria-expanded:text-foreground focus:ring-0 focus:ring-offset-0",
          className
        )}
      >
        <SelectValue placeholder="Select a model" />
      </SelectTrigger>
      <SelectContent>
        {Object.entries(groupedModels).map(([provider, providerModels]) => (
          <SelectGroup key={provider}>
            <SelectLabel>{provider}</SelectLabel>
            {providerModels.map((model) => (
              <SelectItem key={model.id} value={model.id}>
                {model.label}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  )
}
