import { User } from '../models/user.model.js';
import { AppError } from '../utils/app-error.js';

export class UserService {
  async getUserByEmail(email) {
    return User.findOne({ email: email.toLowerCase() });
  }

  async createUser(data) {
    const existing = await this.getUserByEmail(data.email);
    if (existing) {
      throw new AppError(409, 'USER_ALREADY_EXISTS', 'A user with this email already exists');
    }

    const user = await User.create({
      name: data.name,
      email: data.email,
      password: data.password,
      role: data.role ?? 'customer',
    });

    return user;
  }
}

export const userService = new UserService();
