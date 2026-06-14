import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getAsset, getPasses, getPosition } from '../api/orbitalApi'
import { useObserverStore } from '../stores/observerStore'
import type { AssetPosition, OrbitalAsset, PassPrediction } from '../types/orbital'
import { formatDate, formatNumber } from '../utils/format'

export function AssetDetailPage() {
  const catalogNumber = Number(useParams().catalogNumber)
  const [asset, setAsset] = useState<OrbitalAsset>()
  const [position, setPosition] = useState<AssetPosition>()
  const [passes, setPasses] = useState<PassPrediction[]>([])
  const { latitude, longitude } = useObserverStore()

  useEffect(() => {
    if (!Number.isFinite(catalogNumber)) return
    void Promise.all([getAsset(catalogNumber), getPosition(catalogNumber), getPasses(catalogNumber, latitude ?? 0, longitude ?? 0)])
      .then(([assetData, positionData, passData]) => {
        setAsset(assetData)
        setPosition(positionData)
        setPasses(passData)
      })
  }, [catalogNumber, latitude, longitude])

  if (!asset) return <p>Loading asset...</p>

  return (
    <div>
      <div className="page-head"><h1>{asset.displayName ?? asset.catalogNumber}</h1><Link to="/assets">Back to assets</Link></div>
      <div className="grid two">
        <section className="panel">
          <h2>Current Position</h2>
          <dl>
            <dt>Latitude</dt><dd>{formatNumber(position?.latitude, 3)}</dd>
            <dt>Longitude</dt><dd>{formatNumber(position?.longitude, 3)}</dd>
            <dt>Altitude</dt><dd>{formatNumber(position?.altitudeKm, 1)} km</dd>
            <dt>Velocity</dt><dd>{formatNumber(position?.velocityKmps, 2)} km/s</dd>
            <dt>Inclination</dt><dd>{formatNumber(position?.inclinationDeg, 2)} deg</dd>
          </dl>
        </section>
        <section className="panel">
          <h2>Asset Metadata</h2>
          <dl>
            <dt>Operator</dt><dd>{asset.operatorName ?? 'n/a'}</dd>
            <dt>Country</dt><dd>{asset.originCountry ?? 'n/a'}</dd>
            <dt>Launch</dt><dd>{formatDate(asset.launchDate)}</dd>
            <dt>Class</dt><dd>{asset.assetClass}</dd>
          </dl>
        </section>
      </div>
      <section className="panel">
        <h2>Upcoming Passes</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Acquisition</th><th>Loss</th><th>Max Elevation</th><th>Direction</th><th>Score</th></tr></thead>
            <tbody>
              {passes.map((pass) => (
                <tr key={`${pass.acquisitionTime}-${pass.lossTime}`}>
                  <td>{formatDate(pass.acquisitionTime)}</td>
                  <td>{formatDate(pass.lossTime)}</td>
                  <td>{formatNumber(pass.maxElevation, 1)} deg</td>
                  <td>{pass.direction}</td>
                  <td>{pass.visibility}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
