// /retail-orders/reviews — shop reviews now live on the one Reviews screen, under Shop.
import { redirect } from 'next/navigation';

export default function RetailReviewsPage() {
  redirect('/reviews?tab=shop');
}
