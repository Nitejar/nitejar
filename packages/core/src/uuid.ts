import { v7 as uuidv7 } from 'uuid'

export function generateUuidV7(date?: Date): string {
  return date ? uuidv7({ msecs: date.getTime() }) : uuidv7()
}
