export type RootStackParamList = {
  WatchList: undefined;
  WatchDetail: { watchId: string };
  Schedule: { watchId: string };
  EventEdit: { watchId: string; eventId?: number };
  WatchPair: { watchId: string };
  PrayerSettings: { watchId: string };
  Alarms: { watchId: string };
  Beacon: { watchId: string };
  Weather: { watchId: string };
  Notifications: { watchId: string };
  Update: { watchId: string };
  AppleLogin: undefined;
  FindMyMap: { watchId: string };
  FindMySettings: undefined;
};
