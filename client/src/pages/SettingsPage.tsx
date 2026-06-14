import { LocateFixed, Save } from 'lucide-react'
import { useObserverStore } from '../stores/observerStore'

export function SettingsPage() {
  const { latitude, longitude, status, setLocation, locate } = useObserverStore()

  return (
    <div>
      <div className="page-head"><h1>Settings</h1><span>Observer location</span></div>
      <section className="panel settings-form">
        <label>
          Latitude
          <input type="number" step="0.000001" value={latitude ?? ''} onChange={(event) => setLocation(Number(event.target.value), longitude ?? 0)} />
        </label>
        <label>
          Longitude
          <input type="number" step="0.000001" value={longitude ?? ''} onChange={(event) => setLocation(latitude ?? 0, Number(event.target.value))} />
        </label>
        <div className="actions">
          <button onClick={locate}><LocateFixed size={16} /> Use browser location</button>
          <button onClick={() => setLocation(latitude ?? 0, longitude ?? 0)}><Save size={16} /> Save</button>
        </div>
        <p>Status: {status}</p>
      </section>
    </div>
  )
}
