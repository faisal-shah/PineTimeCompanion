export type RootStackParamList = {
  WatchList: undefined;
  WatchDetail: { watchId: string };
  Schedule: { watchId: string };
  EventEdit: { watchId: string; eventId?: number };
  WatchPair: { watchId: string };
  PrayerSettings: { watchId: string };
  Alarms: { watchId: string };
  Beacon: { watchId: string };
  AppleLogin: undefined;
  FindMyMap: { watchId: string };
  FindMySettings: undefined;
};
