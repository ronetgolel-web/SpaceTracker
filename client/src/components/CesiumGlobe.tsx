import { useEffect, useRef, useState } from 'react'
import * as Cesium from 'cesium'
import { getGlobeAssets, fetchGlobeAsset } from '../api/orbitalApi'
import { useGlobeStore } from '../stores/globeStore'
import type { GlobeAsset } from '../types/orbital'

type BillboardMap = Map<number, Cesium.Billboard>

export function CesiumGlobe() {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const viewerRef = useRef<Cesium.Viewer | null>(null)
  const trackingEntityRef = useRef<Cesium.Entity | null>(null)
  const billboardsRef = useRef<Cesium.BillboardCollection | null>(null)
  const billboardMapRef = useRef<BillboardMap>(new Map())
  const geoJsonRef = useRef<Cesium.GeoJsonDataSource | null>(null)
  const hoveredRef = useRef<{ billboard: Cesium.Billboard, originalColor: Cesium.Color } | null>(null)
  const hoverTimeoutRef = useRef<number | null>(null)
  const [hoverInfo, setHoverInfo] = useState<{
    show: boolean;
    x: number;
    y: number;
    asset?: GlobeAsset;
  }>({ show: false, x: 0, y: 0 })
  const setSelected = useGlobeStore((state) => state.setSelected)
  const selected = useGlobeStore((state) => state.selected)
  const mapStyle = useGlobeStore((state) => state.mapStyle)
  const targetCatalogNumber = useGlobeStore((state) => state.targetCatalogNumber)
  const flyToTrigger = useGlobeStore((state) => state.flyToTrigger)
  const filterCategory = useGlobeStore((state) => state.filterCategory)
  
  const prevSelectedRef = useRef<number | null>(null)

  useEffect(() => {
    console.log('[CesiumGlobe] Component mounting')
    if (!containerRef.current) return

    Cesium.Ion.defaultAccessToken = import.meta.env.VITE_CESIUM_ION_TOKEN || ''

    const viewer = new Cesium.Viewer(containerRef.current, {
      animation: false,
      timeline: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
      baseLayer: false, // We manage layers manually
    })
    viewer.scene.globe.enableLighting = true
    viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#10253f')
    viewer.scene.postProcessStages.fxaa.enabled = true
    
    // Reduce camera sensitivity and inertia to stop wild spinning and slow down drag
    viewer.scene.screenSpaceCameraController.inertiaSpin = 0.7
    viewer.scene.screenSpaceCameraController.inertiaTranslate = 0.7
    viewer.scene.screenSpaceCameraController.inertiaZoom = 0.7
    viewer.scene.screenSpaceCameraController.maximumMovementRatio = 0.05
    
    viewerRef.current = viewer

    const billboards = viewer.scene.primitives.add(new Cesium.BillboardCollection())
    billboardsRef.current = billboards

    Cesium.GeoJsonDataSource.load('https://raw.githubusercontent.com/datasets/geo-boundaries-world-110m/master/countries.geojson', {
      stroke: Cesium.Color.BLACK,
      fill: Cesium.Color.TRANSPARENT,
      strokeWidth: 3,
      clampToGround: false,
    }).then((ds) => {
      if (!viewer.isDestroyed()) {
        const entities = ds.entities.values;
        // The Polygon pipeline crashes on huge countries (RhumbLineSubdivision RangeError).
        // To fix this, we extract the raw positions from the polygons and turn them into Polylines!
        for (let i = 0; i < entities.length; i++) {
          const entity = entities[i];
          if (entity.polygon) {
            const hierarchyProp = entity.polygon.hierarchy;
            if (hierarchyProp) {
              const hierarchy = hierarchyProp.getValue(Cesium.JulianDate.now());
              if (hierarchy) {
                // Main outer border
                if (hierarchy.positions && hierarchy.positions.length > 0) {
                  entity.polyline = new Cesium.PolylineGraphics({
                    positions: hierarchy.positions,
                    width: 3,
                    material: Cesium.Color.BLACK,
                    clampToGround: false
                  });
                }
                // Sub-borders (holes like lakes/inner countries)
                if (hierarchy.holes && hierarchy.holes.length > 0) {
                  for (const hole of hierarchy.holes) {
                    if (hole.positions && hole.positions.length > 0) {
                      ds.entities.add(new Cesium.Entity({
                        polyline: {
                          positions: hole.positions,
                          width: 3,
                          material: Cesium.Color.BLACK,
                          clampToGround: false
                        }
                      }));
                    }
                  }
                }
              }
            }
            // Strip the crashing polygon geometry completely!
            entity.polygon = undefined as any;
          }
        }
        
        geoJsonRef.current = ds
        ds.show = false
        viewer.dataSources.add(ds)
      }
    }).catch(console.error)

    let currentBorderWidth = 3
    const removeListener = viewer.scene.preUpdate.addEventListener(() => {
      const height = viewer.camera.positionCartographic.height
      const indicator = document.getElementById('altitude-indicator')
      if (indicator) {
        indicator.innerText = `Altitude: ${(height / 1000).toLocaleString(undefined, { maximumFractionDigits: 0 })} km`
      }
      if (geoJsonRef.current) {
        const currentStyle = useGlobeStore.getState().mapStyle
        geoJsonRef.current.show = currentStyle === 'map' && height <= 29307000

        // Dynamic border width based on altitude
        let newWidth = 3
        if (height > 8000000) newWidth = 1
        else if (height > 3000000) newWidth = 2
        
        if (newWidth !== currentBorderWidth) {
          currentBorderWidth = newWidth
          const targetWidth = new Cesium.ConstantProperty(newWidth)
          for (const entity of geoJsonRef.current.entities.values) {
            if (entity.polyline) {
              entity.polyline.width = targetWidth
            }
          }
        }
      }
    })

    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)
    handler.setInputAction((movement: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      const picked = viewer.scene.pick(movement.position)
      if (Cesium.defined(picked) && picked.primitive && picked.id && (picked.id as any).asset) {
        const asset = (picked.id as any).asset as GlobeAsset
        setSelected(asset)
        if (trackingEntityRef.current) {
          viewer.flyTo(trackingEntityRef.current, {
            duration: 0.9,
            offset: new Cesium.HeadingPitchRange(0, -0.7, 1_400_000)
          }).then(() => {
            viewer.trackedEntity = trackingEntityRef.current || undefined
          })
        }
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK)

    handler.setInputAction((movement: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      const picked = viewer.scene.pick(movement.position)
      if (!Cesium.defined(picked)) {
        setSelected(undefined)
        useGlobeStore.getState().setFilterCategory(null)
        useGlobeStore.getState().setTargetCatalogNumber(null)
        viewer.trackedEntity = undefined
        viewer.camera.flyHome(1.5)
      }
    }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK)

    handler.setInputAction((movement: Cesium.ScreenSpaceEventHandler.MotionEvent) => {
      const picked = viewer.scene.pick(movement.endPosition)
      
      if (Cesium.defined(picked) && picked.primitive && picked.id && (picked.id as any).asset) {
        const asset = (picked.id as any).asset as GlobeAsset
        const billboard = picked.primitive as Cesium.Billboard
        
        if (hoveredRef.current?.billboard !== billboard) {
          if (hoveredRef.current) {
            const prevHoveredAsset = (hoveredRef.current.billboard.id as any).asset as GlobeAsset
            const isSel = useGlobeStore.getState().selected?.catalogNumber === prevHoveredAsset.catalogNumber
            applyBillboardStyle(hoveredRef.current.billboard, prevHoveredAsset, useGlobeStore.getState().filterCategory, isSel)
          }
          hoveredRef.current = { billboard, originalColor: billboard.color.clone() }
          billboard.color = Cesium.Color.LIGHTGREEN
        }

        if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current)
        
        hoverTimeoutRef.current = window.setTimeout(() => {
          setHoverInfo({ show: true, x: movement.endPosition.x, y: movement.endPosition.y, asset })
        }, 100)

      } else {
        if (hoveredRef.current) {
          const prevHoveredAsset = (hoveredRef.current.billboard.id as any).asset as GlobeAsset
          const isSel = useGlobeStore.getState().selected?.catalogNumber === prevHoveredAsset.catalogNumber
          try {
            applyBillboardStyle(hoveredRef.current.billboard, prevHoveredAsset, useGlobeStore.getState().filterCategory, isSel)
          } catch(e) {}
          hoveredRef.current = null
        }
        if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current)
        setHoverInfo(prev => prev.show ? { ...prev, show: false } : prev)
      }
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE)

    const scratchVelocity = new Cesium.Cartesian3()
    const scratchPosition = new Cesium.Cartesian3()

    const preUpdateListener = () => {
      if (!billboardsRef.current) return
      const length = billboardsRef.current.length
      const now = performance.now()
      for (let i = 0; i < length; i++) {
        const b = billboardsRef.current.get(i)
        const data = b.id as any
        if (!data || !data.velocity || !data.basePosition) continue
        
        const dt = (now - data.updateTime) / 1000.0
        Cesium.Cartesian3.multiplyByScalar(data.velocity, dt, scratchVelocity)
        Cesium.Cartesian3.add(data.basePosition, scratchVelocity, scratchPosition)
        b.position = scratchPosition
      }
    }
    viewer.scene.preUpdate.addEventListener(preUpdateListener)

    let cancelled = false
    const refresh = async (isInitial = false) => {
      console.log('[CesiumGlobe] Fetching assets...')
      let simulatedProgress = 0
      let progressInterval: number | undefined

      if (isInitial) {
        useGlobeStore.getState().setIsLoading(true)
        useGlobeStore.getState().setLoadProgress(0)
        progressInterval = window.setInterval(() => {
          // Asymptotically approach 90% while waiting for network/parsing
          simulatedProgress += (90 - simulatedProgress) * 0.1
          useGlobeStore.getState().setLoadProgress(Math.round(simulatedProgress))
        }, 100)
      }

      try {
        const { assets } = await getGlobeAssets(25_000)
        if (isInitial) console.log(`[CesiumGlobe] Fetched ${assets?.length} assets`)
        
        if (cancelled || viewer.isDestroyed() || !billboardsRef.current) {
          if (isInitial) console.log('[CesiumGlobe] Refresh aborted: cancelled, destroyed, or no billboards collection')
          if (progressInterval) clearInterval(progressInterval)
          return
        }

        // Parse and render the billboards
        updateBillboards(billboardsRef.current, billboardMapRef.current, assets)
        
        if (isInitial) {
          if (progressInterval) clearInterval(progressInterval)
          useGlobeStore.getState().setLoadProgress(100)
          setTimeout(() => {
            if (!cancelled) useGlobeStore.getState().setIsLoading(false)
          }, 400)
        }

      } catch (err) {
        console.error('[CesiumGlobe] Error fetching assets:', err)
        if (isInitial) {
          if (progressInterval) clearInterval(progressInterval)
          useGlobeStore.getState().setIsLoading(false)
        }
      }
    }

    refresh(true) // Initial load triggers the UI bar
    const timer = window.setInterval(() => refresh(false).catch(console.error), 15_000)

    let isSpaceHeld = false
    let isDragging = false
    let lastMousePosition: Cesium.Cartesian2 | null = null

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat && !viewer.isDestroyed()) {
        isSpaceHeld = true
        viewer.scene.screenSpaceCameraController.enableRotate = false
        const canvas = viewer.scene.canvas as HTMLCanvasElement
        canvas.style.cursor = isDragging ? 'grabbing' : 'grab'
      }
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !viewer.isDestroyed()) {
        isSpaceHeld = false
        viewer.scene.screenSpaceCameraController.enableRotate = true
        const canvas = viewer.scene.canvas as HTMLCanvasElement
        canvas.style.cursor = 'default'
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)

    const dragHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)
    
    dragHandler.setInputAction((movement: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      isDragging = true
      lastMousePosition = movement.position.clone()
      if (isSpaceHeld) {
        const canvas = viewer.scene.canvas as HTMLCanvasElement
        canvas.style.cursor = 'grabbing'
      }
    }, Cesium.ScreenSpaceEventType.LEFT_DOWN)
    
    dragHandler.setInputAction((movement: Cesium.ScreenSpaceEventHandler.MotionEvent) => {
      if (isDragging && isSpaceHeld && lastMousePosition) {
        const deltaX = movement.endPosition.x - lastMousePosition.x
        const deltaY = movement.endPosition.y - lastMousePosition.y
        
        // Scale movement speed by camera altitude so it feels 1:1
        const height = viewer.camera.positionCartographic.height
        const scalar = height * 0.0015 

        viewer.camera.moveLeft(deltaX * scalar)
        viewer.camera.moveUp(deltaY * scalar)
        
        lastMousePosition = movement.endPosition.clone()
      } else if (isDragging) {
        lastMousePosition = movement.endPosition.clone()
      }
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE)

    dragHandler.setInputAction(() => {
      isDragging = false
      lastMousePosition = null
      if (isSpaceHeld) {
        const canvas = viewer.scene.canvas as HTMLCanvasElement
        canvas.style.cursor = 'grab'
      }
    }, Cesium.ScreenSpaceEventType.LEFT_UP)

    return () => {
      cancelled = true
      window.clearInterval(timer)
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current)
      viewer.scene.preUpdate.removeEventListener(preUpdateListener)
      removeListener()
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      handler.destroy()
      dragHandler.destroy()
      viewer.destroy()
      viewerRef.current = null
      billboardMapRef.current.clear()
    }
  }, [setSelected])

  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer) return

    let cancelled = false

    const loadImagery = async () => {
      viewer.scene.imageryLayers.removeAll()
      let provider: Cesium.ImageryProvider | undefined

      if (mapStyle === 'map') {
        viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#015f96')
      } else {
        viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#10253f')
      }

      try {
        if (mapStyle === 'satellite') {
          provider = await Cesium.ArcGisMapServerImageryProvider.fromUrl(
            'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer'
          )
        } else if (mapStyle === 'map') {
          provider = new Cesium.OpenStreetMapImageryProvider({
            url: 'https://a.tile.openstreetmap.org/',
          })
        } else if (mapStyle === 'ion') {
          const token = import.meta.env.VITE_CESIUM_ION_TOKEN
          if (token) {
            Cesium.Ion.defaultAccessToken = token
            provider = await Cesium.IonImageryProvider.fromAssetId(2) // Bing Maps Aerial
          } else {
            console.warn('VITE_CESIUM_ION_TOKEN is not set, falling back to satellite mode.')
            provider = await Cesium.ArcGisMapServerImageryProvider.fromUrl(
              'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer'
            )
          }
        }
      } catch (e) {
        console.error('Failed to load imagery provider', e)
      }

      if (!cancelled && provider && !viewer.isDestroyed()) {
        const layer = viewer.scene.imageryLayers.addImageryProvider(provider)
        
        if (mapStyle === 'map') {
          layer.colorToAlpha = Cesium.Color.fromCssColorString('#aad3df')
          layer.colorToAlphaThreshold = 0.15
          layer.brightness = 1.1
          layer.contrast = 1.1
          layer.saturation = 0.0
        }
      }
    }

    loadImagery()

    // Initialize invisible tracking entity
    trackingEntityRef.current = viewer.entities.add({
      position: new Cesium.CallbackProperty(() => {
        const sel = useGlobeStore.getState().selected
        if (!sel || !billboardMapRef.current) return undefined
        const b = billboardMapRef.current.get(sel.catalogNumber)
        return b ? b.position : undefined
      }, false) as any,
      point: { show: false }
    })

    return () => { 
      cancelled = true
    }
  }, [mapStyle])

  useEffect(() => {
    if (!viewerRef.current || !billboardMapRef.current || !billboardsRef.current || targetCatalogNumber === null) return

    const flyToAsset = (asset: GlobeAsset) => {
      setSelected(asset)
      if (viewerRef.current && trackingEntityRef.current) {
        viewerRef.current.flyTo(trackingEntityRef.current, {
          duration: 0.9,
          offset: new Cesium.HeadingPitchRange(0, -0.7, 1_400_000)
        }).then(() => {
          if (viewerRef.current) viewerRef.current.trackedEntity = trackingEntityRef.current || undefined
        })
      }
    }

    const billboard = billboardMapRef.current.get(targetCatalogNumber)
    if (billboard && billboard.id) {
      flyToAsset((billboard.id as any).asset as GlobeAsset)
    } else {
      fetchGlobeAsset(targetCatalogNumber).then(asset => {
        if (asset && billboardsRef.current && billboardMapRef.current) {
          const position = Cesium.Cartesian3.fromDegrees(asset.longitude, asset.latitude, asset.altitudeKm * 1000)
          const velocity = asset.velocityEcf ? new Cesium.Cartesian3(asset.velocityEcf.x * 1000, asset.velocityEcf.y * 1000, asset.velocityEcf.z * 1000) : Cesium.Cartesian3.ZERO
          const entityData = { asset, basePosition: position, velocity, updateTime: performance.now() }
          
          const newBillboard = billboardsRef.current.add({
            position: position,
            image: CIRCLE_SVG,
            color: colorForClass(asset.assetClass),
            scaleByDistance: new Cesium.NearFarScalar(1.0e5, 0.3, 8.0e6, 0.025),
            id: entityData
          })
          billboardMapRef.current.set(asset.catalogNumber, newBillboard)
          
          flyToAsset(asset)
        }
      })
    }
  }, [targetCatalogNumber, flyToTrigger, setSelected])

  useEffect(() => {
    if (!billboardMapRef.current) return
    for (const [_, billboard] of billboardMapRef.current) {
      const data = billboard.id as any
      if (!data) continue
      const asset = data.asset as GlobeAsset
      const isSelected = selected && asset.catalogNumber === selected.catalogNumber
      applyBillboardStyle(billboard, asset, filterCategory, !!isSelected)
    }
  }, [filterCategory])

  useEffect(() => {
    if (!billboardMapRef.current) return

    if (prevSelectedRef.current !== null) {
      const prevBillboard = billboardMapRef.current.get(prevSelectedRef.current)
      if (prevBillboard) {
        const asset = (prevBillboard.id as any).asset as GlobeAsset
        try {
          applyBillboardStyle(prevBillboard, asset, filterCategory, false)
        } catch (e) {}
      }
      prevSelectedRef.current = null
    }

    if (selected) {
      const billboard = billboardMapRef.current.get(selected.catalogNumber)
      if (billboard) {
        const asset = (billboard.id as any).asset as GlobeAsset
        applyBillboardStyle(billboard, asset, filterCategory, true)
        prevSelectedRef.current = selected.catalogNumber
      }
    }
  }, [selected])

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div ref={containerRef} className="globe-canvas" />
      
      {hoverInfo.show && hoverInfo.asset && (
        <div 
          style={{
            position: 'absolute',
            top: hoverInfo.y + 15,
            left: hoverInfo.x + 15,
            pointerEvents: 'none',
            backgroundColor: 'rgba(16, 37, 63, 0.9)',
            border: '1px solid #3b82f6',
            color: 'white',
            padding: '8px 12px',
            borderRadius: '6px',
            fontSize: '14px',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
            zIndex: 50,
            backdropFilter: 'blur(4px)',
            whiteSpace: 'nowrap'
          }}
        >
          <div style={{ fontWeight: 'bold', marginBottom: '2px' }}>{hoverInfo.asset.name || 'Unknown Satellite'}</div>
          <div style={{ fontSize: '12px', color: '#93c5fd' }}>{hoverInfo.asset.assetClass} • NORAD: {hoverInfo.asset.catalogNumber}</div>
        </div>
      )}
    </div>
  )
}

const CIRCLE_SVG = `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><circle cx="64" cy="64" r="56" fill="white" stroke="black" stroke-width="6"/></svg>')}`
const SELECTED_CIRCLE_SVG = `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><defs><filter id="glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="8" result="blur" /><feComposite in="SourceGraphic" in2="blur" operator="over" /></filter></defs><circle cx="64" cy="64" r="48" fill="white" stroke="white" stroke-width="4" filter="url(#glow)"/></svg>')}`

function applyBillboardStyle(billboard: Cesium.Billboard, asset: GlobeAsset, filterCategory: string | null, isSelected: boolean) {
  if (isSelected) {
    billboard.color = Cesium.Color.LIGHTGREEN
    billboard.image = SELECTED_CIRCLE_SVG
    billboard.scaleByDistance = new Cesium.NearFarScalar(1.0e5, 0.3 * 1.5, 8.0e6, 0.025 * 1.5)
  } else {
    billboard.image = CIRCLE_SVG
    billboard.scaleByDistance = new Cesium.NearFarScalar(1.0e5, 0.3, 8.0e6, 0.025)
    if (filterCategory === null || asset.assetClass === filterCategory || asset.assetClass.includes(filterCategory)) {
      billboard.color = colorForClass(asset.assetClass)
    } else {
      const dimmedColor = colorForClass(asset.assetClass).clone()
      dimmedColor.alpha = 0.1
      billboard.color = dimmedColor
    }
  }
}

function updateBillboards(billboards: Cesium.BillboardCollection, billboardMap: BillboardMap, assets: GlobeAsset[]) {
  console.log(`[CesiumGlobe] Updating billboards for ${assets.length} assets...`)
  let added = 0
  let updated = 0
  const seen = new Set<number>()
  for (const asset of assets) {
    seen.add(asset.catalogNumber)
    const position = Cesium.Cartesian3.fromDegrees(asset.longitude, asset.latitude, asset.altitudeKm * 1000)
    const velocity = asset.velocityEcf ? new Cesium.Cartesian3(asset.velocityEcf.x * 1000, asset.velocityEcf.y * 1000, asset.velocityEcf.z * 1000) : Cesium.Cartesian3.ZERO
    const entityData = { asset, basePosition: position, velocity, updateTime: performance.now() }
    
    const existing = billboardMap.get(asset.catalogNumber)
    if (existing) {
      existing.position = position
      existing.id = entityData
      updated++
      continue
    }
    const billboard = billboards.add({
      position,
      image: CIRCLE_SVG,
      color: colorForClass(asset.assetClass),
      scaleByDistance: new Cesium.NearFarScalar(1.0e5, 0.3, 8.0e6, 0.025),
      id: entityData,
    })
    billboardMap.set(asset.catalogNumber, billboard)
    added++
  }

  let removed = 0
  for (const [catalogNumber, billboard] of billboardMap) {
    if (!seen.has(catalogNumber)) {
      billboards.remove(billboard)
      billboardMap.delete(catalogNumber)
      removed++
    }
  }
  
  console.log(`[CesiumGlobe] Billboards updated. Added: ${added}, Updated: ${updated}, Removed: ${removed}. Total: ${billboardMap.size}`)
}

function colorForClass(assetClass: GlobeAsset['assetClass']) {
  if (assetClass === 'DEBRIS') return Cesium.Color.SALMON
  if (assetClass === 'NAVIGATION') return Cesium.Color.LIME
  if (assetClass === 'COMMUNICATION') return Cesium.Color.CYAN
  if (assetClass === 'WEATHER' || assetClass === 'EARTH_OBSERVATION') return Cesium.Color.GOLD
  return Cesium.Color.WHITE
}
