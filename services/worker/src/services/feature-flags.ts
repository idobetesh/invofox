import { FeatureFlagsService } from '../../../../shared/services/feature-flags';
import { getFirestore } from './firestore.service';

export const featureFlags = new FeatureFlagsService(getFirestore());
