import { SpaceTool } from './tool-registry.js';
import * as orbitalService from '../../services/orbital.service.js';
import type { AssetClass } from '@prisma/client';

export const satelliteLookupTool: SpaceTool = {
  name: 'satellite_lookup',
  description: 'Search for satellites in the database by name, catalog number (NORAD ID), or asset class.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Name or partial name of the satellite to search for (e.g., "ISS", "Starlink")' },
      catalogNumber: { type: 'number', description: 'The exact NORAD catalog number (e.g., 25544)' },
      assetClass: { type: 'string', enum: ['PAYLOAD', 'ROCKET_BODY', 'DEBRIS', 'UNKNOWN'], description: 'Filter by type of asset' }
    }
  },
  handler: async (args: any) => {
    const results = await orbitalService.listAssets({
      search: args.query,
      catalogNumber: args.catalogNumber,
      assetClass: args.assetClass as AssetClass,
    });
    return {
      count: results.length,
      satellites: results.slice(0, 10).map(s => ({
        catalogNumber: s.catalogNumber,
        name: s.displayName,
        type: s.assetClass,
        operator: s.operatorName,
        country: s.originCountry,
        launchDate: s.launchDate
      }))
    };
  }
};

export const getSatellitePositionTool: SpaceTool = {
  name: 'get_satellite_position',
  description: 'Get the current real-time position, altitude, and velocity of a specific satellite.',
  parameters: {
    type: 'object',
    properties: {
      catalogNumber: { type: 'number', description: 'The NORAD catalog number of the satellite (e.g., 25544 for ISS)' }
    },
    required: ['catalogNumber']
  },
  handler: async (args: any) => {
    return await orbitalService.getCurrentPosition(args.catalogNumber);
  }
};

export const predictPassesTool: SpaceTool = {
  name: 'predict_passes',
  description: 'Predict upcoming passes (visibility windows) of a satellite for a specific ground location.',
  parameters: {
    type: 'object',
    properties: {
      catalogNumber: { type: 'number', description: 'NORAD catalog number of the satellite' },
      latitude: { type: 'number', description: 'Observer latitude in degrees (e.g. 40.7128)' },
      longitude: { type: 'number', description: 'Observer longitude in degrees (e.g. -74.0060)' },
      hoursAhead: { type: 'number', description: 'Hours ahead to predict (default 24)' }
    },
    required: ['catalogNumber', 'latitude', 'longitude']
  },
  handler: async (args: any) => {
    return await orbitalService.predictPasses(
      args.catalogNumber,
      { latitude: args.latitude, longitude: args.longitude },
      args.hoursAhead || 24
    );
  }
};

export const getOverheadSatellitesTool: SpaceTool = {
  name: 'get_overhead_satellites',
  description: 'Get a list of all trackable satellites currently overhead for a given location.',
  parameters: {
    type: 'object',
    properties: {
      latitude: { type: 'number', description: 'Observer latitude in degrees' },
      longitude: { type: 'number', description: 'Observer longitude in degrees' },
      minimumElevation: { type: 'number', description: 'Minimum elevation angle in degrees (default 10)' }
    },
    required: ['latitude', 'longitude']
  },
  handler: async (args: any) => {
    const results = await orbitalService.getOverheadAssets({
      latitude: args.latitude,
      longitude: args.longitude,
      minimumElevation: args.minimumElevation || 10
    });
    return {
      count: results.length,
      visibleSatellites: results.slice(0, 15).map(s => ({
        catalogNumber: s.asset.catalogNumber,
        name: s.asset.displayName,
        elevation: s.elevation,
        azimuth: s.azimuth,
        rangeKm: s.rangeKm
      }))
    };
  }
};

export const getSatelliteInfoTool: SpaceTool = {
  name: 'get_satellite_info',
  description: 'Get detailed orbital information and metadata for a specific satellite.',
  parameters: {
    type: 'object',
    properties: {
      catalogNumber: { type: 'number', description: 'NORAD catalog number of the satellite' }
    },
    required: ['catalogNumber']
  },
  handler: async (args: any) => {
    const info = await orbitalService.getOrbitalInformation(args.catalogNumber);
    return {
      name: info.asset.displayName,
      catalogNumber: info.asset.catalogNumber,
      designator: info.asset.internationalDesignator,
      type: info.asset.assetClass,
      operator: info.asset.operatorName,
      country: info.asset.originCountry,
      launchDate: info.asset.launchDate,
      position: {
        latitude: info.position.latitude,
        longitude: info.position.longitude,
        altitudeKm: info.position.altitudeKm,
        velocityKmps: info.position.velocityKmps,
        inclinationDeg: info.position.inclinationDeg
      }
    };
  }
};

export const countSatellitesTool: SpaceTool = {
  name: 'count_satellites',
  description: 'Count the number of satellites in the database matching specific criteria.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Name search query (e.g., "Starlink")' },
      assetClass: { type: 'string', enum: ['PAYLOAD', 'ROCKET_BODY', 'DEBRIS', 'UNKNOWN'], description: 'Filter by asset class' }
    }
  },
  handler: async (args: any) => {
    const results = await orbitalService.listAssets({
      search: args.query,
      assetClass: args.assetClass as AssetClass,
    });
    return {
      count: results.length,
      sampleSatellites: results.slice(0, 10).map(s => ({
        name: s.displayName,
        catalogNumber: s.catalogNumber
      }))
    };
  }
};
