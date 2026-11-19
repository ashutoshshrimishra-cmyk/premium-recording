import { memo, useEffect } from 'react'
import { Header } from './app/Header'
import { CaptureModePicker } from './app/CaptureModePicker'
import { SourceList } from './app/SourceList'
import { ResolutionFpsPicker } from './app/ResolutionFpsPicker'
import { AudioSelect } from './app/AudioSelect'
import { NoiseToggle } from './app/NoiseToggle'
import { SaveLocation } from './app/SaveLocation'
import { StartButton } from './app/StartButton'
import { useRecorderStore } from './app/store'

const App = memo(function App(): React.JSX.Element {
  const loadSettings = useRecorderStore((state) => state.loadSettings)

  useEffect(() => {
    void loadSettings()
  }, [loadSettings])

  return (
    <main className="h-full bg-[var(--background)] text-[var(--text)]">
      <div className="mx-auto flex h-full max-w-[860px] flex-col px-8 py-5">
        <Header />
        <div className="mt-5 grid min-h-0 flex-1 grid-cols-[220px_1fr] gap-5">
          <section className="flex min-h-0 flex-col gap-4">
            <CaptureModePicker />
            <SourceList />
          </section>
          <section className="flex min-h-0 flex-col rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4">
            <ResolutionFpsPicker />
            <div className="my-4 h-px bg-[var(--border)]" />
            <AudioSelect />
            <div className="my-4 h-px bg-[var(--border)]" />
            <NoiseToggle />
            <div className="mt-auto">
              <SaveLocation />
              <StartButton />
            </div>
          </section>
        </div>
      </div>
    </main>
  )
})

export default App
