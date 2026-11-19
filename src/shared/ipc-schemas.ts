import { z } from 'zod'

export const settingsSchema = z.object({
  saveDir: z.string().min(1),
  fps: z.number().int().positive(),
  resolution: z.enum(['1080p', '1440p', '4K']),
  noiseSuppression: z.boolean()
})

export const getSourcesInputSchema = z.void()
export const getSourcesOutputSchema = z.array(
  z.object({
    id: z.string().min(1),
    name: z.string(),
    displayId: z.string(),
    thumbnail: z.string().startsWith('data:')
  })
)

export const getDisplaysInputSchema = z.void()
export const getDisplaysOutputSchema = z.array(
  z.object({
    id: z.string(),
    bounds: z.object({
      x: z.number(),
      y: z.number(),
      width: z.number().nonnegative(),
      height: z.number().nonnegative()
    }),
    scaleFactor: z.number().positive()
  })
)

export const pickFolderInputSchema = z.void()
export const pickFolderOutputSchema = z.string().nullable()

export const getSettingsInputSchema = z.void()
export const getSettingsOutputSchema = settingsSchema

export const setSettingsInputSchema = settingsSchema
export const setSettingsOutputSchema = settingsSchema

export type Settings = z.infer<typeof settingsSchema>
export type GetSourcesInput = z.infer<typeof getSourcesInputSchema>
export type GetSourcesOutput = z.infer<typeof getSourcesOutputSchema>
export type GetDisplaysInput = z.infer<typeof getDisplaysInputSchema>
export type GetDisplaysOutput = z.infer<typeof getDisplaysOutputSchema>
export type PickFolderInput = z.infer<typeof pickFolderInputSchema>
export type PickFolderOutput = z.infer<typeof pickFolderOutputSchema>
export type GetSettingsInput = z.infer<typeof getSettingsInputSchema>
export type GetSettingsOutput = z.infer<typeof getSettingsOutputSchema>
export type SetSettingsInput = z.infer<typeof setSettingsInputSchema>
export type SetSettingsOutput = z.infer<typeof setSettingsOutputSchema>
