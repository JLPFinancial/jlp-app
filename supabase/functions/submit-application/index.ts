// Enhanced GHL webhook logic for submission handling

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function processWebhook(data) {
    // Validate incoming data
    if (!data || !data.id) {
        throw new Error('Invalid data received from GHL.');
    }

    // TODO: Improve field mapping according to GHL CRM Schema
    const mappedData = {
        id: data.id,
        email: data.email,
        fullname: data.fullname,
        // add further field mappings as per GHL schema
    };

    // Insert into Supabase database
    const { error } = await supabase
        .from('submissions')
        .insert([mappedData]);

    if (error) {
        console.error('Error during submission:', error);
        throw new Error('Submission failed.');
    }
}

export async function POST(request) {
    const { body } = request;

    // Set a timeout for the request
    const timeout = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Request timeout')), 5000);
    });

    try {
        const response = await Promise.race([processWebhook(body), timeout]);
        return NextResponse.json({ status: 'success', data: response });
    } catch (error) {
        console.error('Error handling GHL webhook:', error);
        return NextResponse.json({ status: 'error', message: error.message });
    }
}