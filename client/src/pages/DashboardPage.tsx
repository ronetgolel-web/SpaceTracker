import { useEffect, useMemo, useState } from 'react'
import { getOverhead, listAssets } from '../api/orbitalApi'
import { StatTile } from '../components/StatTile'
import { useObserverStore } from '../stores/observerStore'
import type { OrbitalAsset } from '../types/orbital'
import { formatNumber } from '../utils/format'

export function DashboardPage() {
  const [assets, setAssets] = useState<OrbitalAsset[]>([])
  const [visibleCount, setVisibleCount] = useState(0)
  const { latitude, longitude } = useObserverStore()

  useEffect(() => {
    void listAssets().then(setAssets)
    void getOverhead(latitude ?? 0, longitude ?? 0).then((items: unknown[]) => setVisibleCount(items.length)).catch(() => setVisibleCount(0))
  }, [latitude, longitude])

  const counts = useMemo(() => ({
    communication: assets.filter((asset) => asset.assetClass === 'COMMUNICATION').length,
    navigation: assets.filter((asset) => asset.assetClass === 'NAVIGATION').length,
    debris: assets.filter((asset) => asset.assetClass === 'DEBRIS').length,
  }), [assets])

  return (
    <div>
      <div className="page-head"><h1>Dashboard</h1><span>Live orbital summary</span></div>
      <div className="stats">
        <StatTile label="Total Satellites" value={formatNumber(assets.length)} />
        <StatTile label="Communications" value={counts.communication} />
        <StatTile label="Navigation" value={counts.navigation} />
        <StatTile label="Debris" value={counts.debris} />
      </div>
      <div className="grid two">
        <section className="panel">
          <h2>Observer</h2>
          <p>{formatNumber(latitude, 4)}, {formatNumber(longitude, 4)}</p>
          <strong>{visibleCount}</strong>
          <span> visible above your minimum elevation</span>
        </section>
        <section className="panel">
          <h2>Recent Activity</h2>
          <p>Catalog and TLE sync now start during server boot. Globe data is served through the bulk position endpoint.</p>
        </section>
      </div>
    </div>
  )
}
