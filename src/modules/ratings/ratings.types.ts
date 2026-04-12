export interface SubmitRatingInput {
  stars: number;
  reviewText?: string;
}

export interface SubmittedRating {
  id: string;
  bookingId: string;
  rideId: string;
  raterId: string;
  rateeId: string;
  stars: number;
  reviewText: string | null;
  createdAt: Date;
}
