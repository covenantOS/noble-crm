// ============================================
// NOBLE ESTIMATOR — UTILITIES
// ============================================

import { type ClassValue, clsx } from 'clsx';

export function cn(...inputs: ClassValue[]) {
    return inputs.filter(Boolean).join(' ');
}

// Format phone number for display: (813) 555-0123
export function formatPhone(phone: string): string {
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 10) {
        return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    }
    if (digits.length === 11 && digits.startsWith('1')) {
        return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
    }
    return phone;
}

// Format date for display
export function formatDate(date: Date | string): string {
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    });
}

// Format date + time
export function formatDateTime(date: Date | string): string {
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    });
}

// Format currency
export function formatCurrency(amount: number): string {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    }).format(amount);
}

// Status color mapping
export function getStatusColor(status: string): string {
    const colors: Record<string, string> = {
        DRAFT: 'bg-gray-100 text-gray-700',
        AI_PROCESSING: 'bg-blue-100 text-blue-700',
        REVIEW: 'bg-yellow-100 text-yellow-700',
        SENT: 'bg-indigo-100 text-indigo-700',
        VIEWED: 'bg-purple-100 text-purple-700',
        APPROVED: 'bg-green-100 text-green-700',
        DECLINED: 'bg-red-100 text-red-700',
        EXPIRED: 'bg-gray-100 text-gray-500',
        GENERATED: 'bg-gray-100 text-gray-700',
        SIGNED: 'bg-green-100 text-green-700',
        ACTIVE: 'bg-blue-100 text-blue-700',
        COMPLETED: 'bg-green-100 text-green-700',
        CANCELLED: 'bg-red-100 text-red-700',
        SCHEDULED: 'bg-gray-100 text-gray-700',
        PENDING: 'bg-yellow-100 text-yellow-700',
        PROCESSING: 'bg-blue-100 text-blue-700',
        FAILED: 'bg-red-100 text-red-700',
        RETRYING: 'bg-orange-100 text-orange-700',
        REFUNDED: 'bg-purple-100 text-purple-700',
        PROPOSED: 'bg-yellow-100 text-yellow-700',
        CUSTOMER_NOTIFIED: 'bg-indigo-100 text-indigo-700',
    };
    return colors[status] || 'bg-gray-100 text-gray-700';
}

// Status label formatting
export function formatStatus(status: string): string {
    return status
        .replace(/_/g, ' ')
        .toLowerCase()
        .replace(/\b\w/g, l => l.toUpperCase());
}

// Generate a secure random token
export function generateToken(length: number = 32): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// Calculate net paintable area
export function calcNetPaintableArea(
    linearFeet: number,
    height: number,
    windowDeduction: number = 0,
    doorDeduction: number = 0
): number {
    const grossArea = linearFeet * height;
    return Math.max(0, grossArea - windowDeduction - doorDeduction);
}

// Calculate wall area for interior rooms
export function calcRoomWallArea(
    length: number,
    width: number,
    height: number,
    windowCount: number = 0,
    doorCount: number = 0,
    windowSize: number = 15,
    doorSize: number = 21
): number {
    const perimeter = 2 * (length + width);
    const grossArea = perimeter * height;
    const deductions = windowCount * windowSize + doorCount * doorSize;
    return Math.max(0, grossArea - deductions);
}

// Truncate text
export function truncate(text: string, maxLength: number = 50): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
}

// Convert base64 to file size string
export function base64ToSize(base64: string): string {
    const sizeInBytes = (base64.length * 3) / 4;
    if (sizeInBytes < 1024) return `${sizeInBytes}B`;
    if (sizeInBytes < 1024 * 1024) return `${(sizeInBytes / 1024).toFixed(1)}KB`;
    return `${(sizeInBytes / (1024 * 1024)).toFixed(1)}MB`;
}

// Debounce function
export function debounce<T extends (...args: unknown[]) => unknown>(
    func: T,
    wait: number
): (...args: Parameters<T>) => void {
    let timeout: NodeJS.Timeout;
    return (...args: Parameters<T>) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => func(...args), wait);
    };
}
