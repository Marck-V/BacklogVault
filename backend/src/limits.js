// Size and count limits so one account (or bot) cannot fill the disk of a small server.
export const LIMITS = {
  listName: 100,
  gameName: 200,
  coverUrl: 500,
  notes: 2000,
  maxHours: 100000,
  listsPerUser: 50,
  gamesPerList: 2000,
};
