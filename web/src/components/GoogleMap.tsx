'use client';

import { useEffect, useRef, useState } from 'react';
import { importLibrary, setOptions } from '@googlemaps/js-api-loader';

const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '';

let initialized = false;

function initLoader() {
  if (initialized) return;
  initialized = true;
  setOptions({
    key: GOOGLE_MAPS_API_KEY,
    v: 'weekly',
  });
}

interface GoogleMapProps {
  polyline?: string; // encoded polyline string
  markers?: { lat: number; lng: number; label?: string; color?: 'red' | 'green' | 'blue' | 'orange' }[];
  liveLocation?: { lat: number; lng: number } | null;
  className?: string;
  zoom?: number;
  center?: { lat: number; lng: number };
}

export default function GoogleMap({ polyline, markers, liveLocation, className = 'h-64 w-full rounded-2xl', zoom, center }: GoogleMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const polylineRef = useRef<google.maps.Polyline | null>(null);
  const liveMarkerRef = useRef<google.maps.Marker | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!GOOGLE_MAPS_API_KEY) {
      setError('Google Maps API key not configured');
      return;
    }

    initLoader();
    Promise.all([
      importLibrary('maps'),
      importLibrary('geometry'),
    ]).then(() => {
      setLoaded(true);
    }).catch(() => {
      setError('Failed to load Google Maps');
    });
  }, []);

  // Initialize map once
  useEffect(() => {
    if (!loaded || !mapRef.current || mapInstanceRef.current) return;

    const defaultCenter = center || { lat: 56.95, lng: 24.11 }; // Riga, Baltic region
    const map = new google.maps.Map(mapRef.current, {
      center: defaultCenter,
      zoom: zoom || 7,
      disableDefaultUI: true,
      zoomControl: true,
      styles: [
        { featureType: 'poi', stylers: [{ visibility: 'off' }] },
        { featureType: 'transit', stylers: [{ visibility: 'off' }] },
      ],
    });
    mapInstanceRef.current = map;
  }, [loaded, center, zoom]);

  // Update polyline and markers when props change
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    // Clear old polyline
    if (polylineRef.current) {
      polylineRef.current.setMap(null);
      polylineRef.current = null;
    }

    // Clear old markers
    markersRef.current.forEach(m => m.setMap(null));
    markersRef.current = [];

    // Draw polyline
    if (polyline && google.maps.geometry) {
      const path = google.maps.geometry.encoding.decodePath(polyline);
      const poly = new google.maps.Polyline({
        path,
        strokeColor: '#F97316',
        strokeOpacity: 0.9,
        strokeWeight: 4,
        geodesic: true,
      });
      poly.setMap(map);
      polylineRef.current = poly;

      // Fit bounds to polyline + markers
      const bounds = new google.maps.LatLngBounds();
      path.forEach(p => bounds.extend(p));
      markers?.forEach(m => bounds.extend({ lat: m.lat, lng: m.lng }));
      map.fitBounds(bounds, 40);
    } else if (markers && markers.length > 0) {
      // No polyline, but markers — fit to markers
      const bounds = new google.maps.LatLngBounds();
      markers.forEach(m => bounds.extend({ lat: m.lat, lng: m.lng }));
      map.fitBounds(bounds, 40);
    }

    // Draw markers
    if (markers) {
      markers.forEach(m => {
        const marker = new google.maps.Marker({
          position: { lat: m.lat, lng: m.lng },
          map,
          label: m.label ? { text: m.label, color: '#fff', fontSize: '11px', fontWeight: 'bold' } : undefined,
          icon: m.color ? {
            path: google.maps.SymbolPath.CIRCLE,
            fillColor: m.color === 'green' ? '#16a34a' : m.color === 'blue' ? '#2563eb' : m.color === 'orange' ? '#F97316' : '#ef4444',
            fillOpacity: 1,
            strokeWeight: 2,
            strokeColor: '#fff',
            scale: 8,
          } : undefined,
        });
        markersRef.current.push(marker);
      });
    }
  }, [loaded, polyline, markers]);

  // Update live location marker
  useEffect(() => {
    if (!mapInstanceRef.current || !liveLocation) return;

    if (liveMarkerRef.current) {
      liveMarkerRef.current.setPosition(liveLocation);
    } else {
      liveMarkerRef.current = new google.maps.Marker({
        position: liveLocation,
        map: mapInstanceRef.current,
        icon: {
          path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
          fillColor: '#2563eb',
          fillOpacity: 1,
          strokeWeight: 2,
          strokeColor: '#fff',
          scale: 6,
          rotation: 0,
        },
        title: 'Driver location',
      });
    }

    mapInstanceRef.current.panTo(liveLocation);
  }, [liveLocation]);

  if (error) {
    return (
      <div className={`${className} flex items-center justify-center bg-gray-100 text-sm text-gray-500`}>
        {error}
      </div>
    );
  }

  if (!loaded) {
    return (
      <div className={`${className} flex items-center justify-center bg-gray-100`}>
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-deliivo-orange" />
      </div>
    );
  }

  return <div ref={mapRef} className={className} />;
}
