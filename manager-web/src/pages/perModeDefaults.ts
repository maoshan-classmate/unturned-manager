export interface PerModeValue {
  easy: boolean | string;
  normal: boolean | string;
  hard: boolean | string;
}

export const PER_MODE_DEFAULTS: Record<string, PerModeValue> = {
  "Items.Spawn_Chance": { easy: "0.35", normal: "0.35", hard: "0.15" },
  "Items.Respawn_Time": { easy: "50", normal: "100", hard: "150" },
  "Items.Has_Durability": { easy: false, normal: true, hard: true },
  "Vehicles.Has_Battery_Chance": { easy: "1", normal: "0.8", hard: "0.25" },
  "Vehicles.Min_Battery_Charge": { easy: "0.8", normal: "0.5", hard: "0.1" },
  "Vehicles.Max_Battery_Charge": { easy: "1", normal: "0.75", hard: "0.3" },
  "Vehicles.Has_Tire_Chance": { easy: "1", normal: "0.85", hard: "0.7" },
  "Zombies.Spawn_Chance": { easy: "0.2", normal: "0.25", hard: "0.3" },
  "Zombies.Loot_Chance": { easy: "0.55", normal: "0.5", hard: "0.3" },
  "Zombies.Crawler_Chance": { easy: "0", normal: "0.15", hard: "0.125" },
  "Zombies.Sprinter_Chance": { easy: "0", normal: "0.15", hard: "0.175" },
  "Zombies.Flanker_Chance": { easy: "0", normal: "0.025", hard: "0.05" },
  "Zombies.Burner_Chance": { easy: "0", normal: "0.025", hard: "0.05" },
  "Zombies.Acid_Chance": { easy: "0", normal: "0.025", hard: "0.05" },
  "Zombies.Damage_Multiplier": { easy: "0.75", normal: "1", hard: "1.5" },
  "Zombies.Armor_Multiplier": { easy: "1.25", normal: "1", hard: "0.75" },
  "Zombies.Slow_Movement": { easy: true, normal: false, hard: false },
  "Zombies.Can_Stun": { easy: true, normal: true, hard: false },
  "Zombies.Only_Critical_Stuns": { easy: false, normal: false, hard: true },
  "Zombies.Weapons_Use_Player_Damage": { easy: false, normal: false, hard: true },
  "Animals.Damage_Multiplier": { easy: "0.75", normal: "1", hard: "1.5" },
  "Animals.Armor_Multiplier": { easy: "1.25", normal: "1", hard: "0.75" },
  "Animals.Weapons_Use_Player_Damage": { easy: false, normal: false, hard: true },
  "Players.Food_Default": { easy: "100", normal: "100", hard: "85" },
  "Players.Food_Use_Ticks": { easy: "350", normal: "300", hard: "250" },
  "Players.Water_Default": { easy: "100", normal: "100", hard: "85" },
  "Players.Water_Use_Ticks": { easy: "320", normal: "270", hard: "220" },
  "Players.Experience_Multiplier": { easy: "1.5", normal: "1", hard: "1.5" },
  "Players.Detect_Radius_Multiplier": { easy: "0.5", normal: "1", hard: "1.25" },
  "Players.Lose_Skill_Levels_PvP": { easy: "0", normal: "1", hard: "2" },
  "Players.Lose_Skill_Levels_PvE": { easy: "0", normal: "1", hard: "2" },
  "Players.Can_Break_Legs": { easy: false, normal: true, hard: true },
  "Players.Can_Fix_Legs": { easy: true, normal: true, hard: false },
  "Players.Can_Start_Bleeding": { easy: false, normal: true, hard: true },
  "Players.Can_Stop_Bleeding": { easy: true, normal: true, hard: false },
  "Players.Allow_Instakill_Headshots": { easy: false, normal: false, hard: true },
};
