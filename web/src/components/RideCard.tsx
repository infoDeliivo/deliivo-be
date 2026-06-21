import Link from 'next/link';
import { Star, Users, Car } from 'lucide-react';
import { useTranslation } from '@/lib/i18n-context';

export interface Ride {
  id: string;
  driverName: string;
  driverAvatar: string;
  rating: number;
  reviewCount: number;
  departureTime: string;
  departureDate: string;
  from: string;
  to: string;
  vehicle: string;
  vehicleColor: string;
  seatsBooked: number;
  seatsTotal: number;
  pricePerSeat: number;
  femaleOnly?: boolean;
  noSmoking?: boolean;
  noBicycles?: boolean;
  childSeatAvailable?: boolean;
}

interface RideCardProps {
  ride: Ride;
}

function StarRating({ rating }: { rating: number }) {
  return (
    <span className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          size={13}
          className={
            star <= Math.round(rating)
              ? 'fill-amber-400 text-amber-400'
              : 'fill-gray-200 text-gray-200'
          }
        />
      ))}
    </span>
  );
}

export default function RideCard({ ride }: RideCardProps) {
  const { t } = useTranslation();
  const seatsLeft = ride.seatsTotal - ride.seatsBooked;

  return (
    <article className="card flex flex-col gap-4 transition-shadow hover:shadow-md sm:flex-row sm:items-start">
      {/* Driver info */}
      <div className="flex items-center gap-3 sm:flex-col sm:items-center sm:gap-2 sm:w-24 sm:shrink-0 sm:text-center">
        <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full bg-primary-100 sm:h-14 sm:w-14">
          <div
            className="flex h-full w-full items-center justify-center text-lg font-semibold text-primary-600"
            aria-label={ride.driverName}
          >
            {ride.driverAvatar}
          </div>
        </div>
        <div>
          <p className="text-sm font-semibold text-deliivo-dark leading-tight">
            {ride.driverName}
          </p>
          <div className="mt-0.5 flex items-center gap-1 sm:justify-center">
            <StarRating rating={ride.rating} />
          </div>
          <p className="text-xs text-deliivo-gray">({ride.reviewCount})</p>
        </div>
      </div>

      {/* Ride details */}
      <div className="flex flex-1 flex-col gap-3">
        {/* Time + date */}
        <div className="flex items-center gap-2 text-sm text-deliivo-gray">
          <span className="font-semibold text-deliivo-dark">{ride.departureTime}</span>
          <span>&middot;</span>
          <span>{ride.departureDate}</span>
          {ride.femaleOnly && (
            <span className="ml-1 rounded-full bg-pink-100 px-2 py-0.5 text-xs font-medium text-pink-600">
              {t('ride.womenOnly')}
            </span>
          )}
        </div>
        {(ride.noSmoking || ride.noBicycles || ride.childSeatAvailable) && (
          <div className="flex flex-wrap gap-1.5">
            {ride.noSmoking && <span className="rounded-full bg-orange-50 px-2 py-0.5 text-[11px] font-medium text-deliivo-orange">{t('ride.noSmoking')}</span>}
            {ride.noBicycles && <span className="rounded-full bg-orange-50 px-2 py-0.5 text-[11px] font-medium text-deliivo-orange">{t('ride.noBicycles')}</span>}
            {ride.childSeatAvailable && <span className="rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-700">{t('ride.childSeat')}</span>}
          </div>
        )}

        {/* Route */}
        <div className="flex items-stretch gap-3">
          <div className="flex flex-col items-center gap-1 pt-1">
            <span className="h-2.5 w-2.5 rounded-full border-2 border-primary-500 bg-white" />
            <span className="w-0.5 flex-1 bg-primary-200" />
            <span className="h-2.5 w-2.5 rounded-full bg-primary-500" />
          </div>
          <div className="flex flex-1 flex-col gap-2">
            <p className="text-sm font-medium text-deliivo-dark">{ride.from}</p>
            <p className="text-sm font-medium text-deliivo-dark">{ride.to}</p>
          </div>
        </div>

        {/* Vehicle + seats */}
        <div className="flex flex-wrap items-center gap-3 text-xs text-deliivo-gray">
          <span className="flex items-center gap-1">
            <Car size={13} className="text-deliivo-gray" />
            {ride.vehicle}
            <span
              className="ml-1 inline-block h-2.5 w-2.5 rounded-full border border-gray-200"
              style={{ backgroundColor: ride.vehicleColor }}
              aria-label={ride.vehicleColor}
            />
          </span>
          <span className="flex items-center gap-1">
            <Users size={13} className="text-deliivo-gray" />
            {t('ride.seatsBooked', { booked: ride.seatsBooked, total: ride.seatsTotal })}
            {seatsLeft <= 1 && seatsLeft > 0 && (
              <span className="ml-1 text-amber-500 font-medium">
                {t('ride.leftUrgent', { count: seatsLeft })}
              </span>
            )}
          </span>
        </div>
      </div>

      {/* Price + CTA */}
      <div className="flex shrink-0 flex-row items-center justify-between gap-3 sm:flex-col sm:items-end sm:justify-start">
        <div className="text-right">
          <p className="text-xl font-bold text-primary-500">
            EUR {ride.pricePerSeat}
          </p>
          <p className="text-xs text-deliivo-gray">{t('ride.perSeat')}</p>
        </div>
        <Link
          href={`/rides/${ride.id}`}
          className="btn-primary py-2 px-5 text-sm"
        >
          {t('ride.book')}
        </Link>
      </div>
    </article>
  );
}
