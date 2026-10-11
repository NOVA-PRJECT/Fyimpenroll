import { Injectable, InternalServerErrorException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { EffectiveRuleDocument } from './types';
import { RuleDefinitionSchema } from './schemas';

export interface FileConstraintStoreOptions { baseFilePath?: string; storageDir?: string }

/** Read-only repository rules. Director edits travel in a validated generation request. */
@Injectable()
export class FileConstraintStoreService {
  private readonly baseFilePath: string;
  constructor(options?: FileConstraintStoreOptions) {
    const candidates = [options?.baseFilePath, path.resolve(__dirname, 'constraints.base.json'),
      path.resolve(process.cwd(), 'backend/src/modules/timetable/solver/constraints.base.json'),
      path.resolve(process.cwd(), 'src/modules/timetable/solver/constraints.base.json')].filter(Boolean) as string[];
    this.baseFilePath = options?.baseFilePath || candidates.find(candidate => fs.existsSync(candidate)) || candidates[0];
  }
  getBaseConstraints(): EffectiveRuleDocument {
    try {
      const doc = JSON.parse(fs.readFileSync(this.baseFilePath, 'utf8'));
      if (!Number.isInteger(doc.version) || doc.version < 1 || !doc.schedule || !Array.isArray(doc.schedule.periods)) {
        throw new Error('Invalid repository rule document');
      }
      doc.rules = RuleDefinitionSchema.array().max(100).parse(doc.rules);
      return doc;
    } catch (error) {
      throw new InternalServerErrorException(`Cannot load repository scheduling rules: ${(error as Error).message}`);
    }
  }
  getEffectiveConstraints(_campusId?: string, semester?: number): EffectiveRuleDocument {
    const doc = this.getBaseConstraints();
    if (semester) doc.rules = doc.rules.filter(rule => !rule.targetSemester || rule.targetSemester === semester);
    return doc;
  }
  computeRuleHash(doc: EffectiveRuleDocument): string {
    return crypto.createHash('sha256').update(JSON.stringify(doc)).digest('hex');
  }
}
